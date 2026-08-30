/**
 * Slash command registry and dispatch for the TUI prompt. The same
 * `COMMANDS` table feeds the in-progress `/` palette (see
 * `SlashPalette.tsx`) and the help text, so the two never drift.
 * Commands are intercepted in the input handler and never reach the
 * model — they own their own UX. The returned status tells the prompt
 * what to do next.
 *
 * Commands that need async work (model listing, context resolution)
 * return a `Promise<CommandResult>` — the caller is responsible for
 * awaiting it. Synchronous commands still resolve immediately.
 * @module @deepseek-ai/dsh-tui/commands
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { UiState } from './types.ts'
import { appExit, service } from './services.ts'

/** What a command decided. */
export type CommandResult =
  | { kind: 'handled'; message?: string }
  | { kind: 'exit' }
  | { kind: 'unknown'; input: string }

/**
 * One entry in the slash-command registry. Both the palette and the
 * `/help` text read from this — adding a new command means writing
 * one row here and one case in {@link dispatch}.
 */
export interface CommandMeta {
  /** Canonical name, including the leading `/`. */
  name: string
  /** One-line description shown in the palette and `/help`. */
  description: string
}

/**
 * Slash command registry. Order is the default order in the palette
 * when the buffer is just `/`. Sorted alphabetically by name on
 * filter for stability.
 */
export const COMMANDS: readonly CommandMeta[] = [
  { name: '/clear', description: 'Clear the visible chat (keeps the session log intact)' },
  { name: '/context', description: 'Show model, context window, and token usage' },
  { name: '/exit', description: 'Leave the REPL' },
  { name: '/help', description: 'Show the list of available commands' },
  { name: '/model', description: 'Switch model: /model <name> or <provider>/<name>' },
  { name: '/quit', description: 'Alias for /exit' },
  { name: '/status', description: 'Print the current model and session id' },
]

/**
 * Return the commands whose names start with `buffer` (case-insensitive).
 * The buffer is expected to start with `/`; an empty result means
 * "no match — hide the palette". Sorted alphabetically so the order
 * is stable across keystrokes.
 * @param buffer - the current prompt buffer, e.g. `/he` or `/`.
 */
export function filterCommands(buffer: string): CommandMeta[] {
  const query = buffer.toLowerCase()
  if (!query.startsWith('/')) return []
  return COMMANDS
    .filter(c => c.name.toLowerCase().startsWith(query))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Pretty-print the command list for `/help`. Two columns, padded so
 * the descriptions line up. Sourced from {@link COMMANDS} so the two
 * surfaces stay in lock-step.
 */
function helpText(): string {
  const nameCol = Math.max(...COMMANDS.map(c => c.name.length))
  const rows = [...COMMANDS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `  ${c.name.padEnd(nameCol)}  ${c.description}`)
  return ['Available commands:', ...rows].join('\n')
}

/** Snapshot one command from the registry. */
export interface CommandContext {
  ctx: Context
  agent: Agent
  /** Reset the visible chat to an empty list. */
  resetView: () => void
  /**
   * Switch the live agent's model. `provider` is the registered route;
   * `model` is the model id the provider understands. The change takes
   * effect on the next step that enters prompt assembly.
   */
  setModel: (provider: string, model: string) => Promise<void>
  /** Re-read the current selection from the service and push it to the UI. */
  refreshSelection: () => void
  /** Live UI state for commands that inspect token usage or entries. */
  state: UiState
}

/**
 * Dispatch a `/...` line to its handler. The trailing whitespace is trimmed;
 * a leading `/` is required. Anything unknown returns `kind: 'unknown'`.
 *
 * Async so that commands that call `ctx.llm.listModels()` or similar
 * can `await` without the caller having to change its interface. Sync
 * commands still resolve immediately.
 * @param raw - the raw input line, including the leading `/`.
 * @param cmd - the dispatch context.
 * @returns what the caller should do next.
 */
export async function dispatch(raw: string, cmd: CommandContext): Promise<CommandResult> {
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  switch (name) {
    case '/help':
      return { kind: 'handled', message: helpText() }

    case '/clear':
      cmd.resetView()
      // Deliberately silent. Command output is now an entry in the log, so a
      // "View cleared." message would leave the log one entry long — which
      // both contradicts what the user just watched happen and keeps the
      // banner from returning, since it renders only on an empty log.
      return { kind: 'handled' }

    case '/status': {
      const selection = service(cmd.ctx, 'agentDefaultModel')?.currentSelection()
      const model = selection ? `${selection.provider}/${selection.model}` : 'unknown'
      return {
        kind: 'handled',
        message: `model: ${model}\nsession: ${cmd.agent.id}`,
      }
    }

    case '/model': {
      const args = raw.trim().split(/\s+/).slice(1)
      const selection = service(cmd.ctx, 'agentDefaultModel')?.currentSelection()
      if (args.length === 0) {
        const model = selection ? `${selection.provider}/${selection.model}` : 'unknown'
        return { kind: 'handled', message: `Usage: /model <name>\nCurrent: ${model}\n\nUse /context to see context window and token usage.` }
      }
      if (!selection) {
        return { kind: 'handled', message: 'No default model service available.' }
      }
      // `noUncheckedIndexedAccess` is off, so this is already `string` — the
      // `args.length === 0` guard above is what makes that true in fact.
      const modelArg = args[0]
      const slash = modelArg.indexOf('/')
      let provider: string
      let model: string
      if (slash >= 0) {
        provider = modelArg.slice(0, slash)
        model = modelArg.slice(slash + 1)
      } else {
        provider = selection.provider
        model = modelArg
      }
      await cmd.setModel(provider, model)
      cmd.refreshSelection()
      return { kind: 'handled', message: `Switched to ${provider}/${model}` }
    }

    case '/context': {
      const selection = service(cmd.ctx, 'agentDefaultModel')?.currentSelection()
      const model = selection ? `${selection.provider}/${selection.model}` : 'unknown'
      // Read the latest advertised context window from the session's
      // request-context fold. This is the provider-advertised capacity,
      // not the model's actual limit — the adapter may have a different
      // ceiling at dispatch time.
      const contextWindow = cmd.agent.session.requestContext()?.contextWindow
      const contextStr = contextWindow !== undefined ? contextWindow.toLocaleString() : 'unknown'
      // Sum billed input, cache hits, and output across all assistant entries.
      // The same logic as `totalUsage` in StatusBar, inlined here so
      // commands.ts does not depend on a React component module.
      let input = 0
      let output = 0
      for (const entry of cmd.state.entries) {
        if (entry.kind === 'assistant' && entry.usage) {
          input += entry.usage.inputTokens
          input += entry.usage.cacheReadTokens ?? 0
          input += entry.usage.cacheWriteTokens ?? 0
          output += entry.usage.outputTokens
        }
      }
      const inputStr = input.toLocaleString()
      const outputStr = output.toLocaleString()
      let msg = `model: ${model}\ncontext window: ${contextStr}\ninput (billed): ${inputStr}\noutput: ${outputStr}`
      if (contextWindow !== undefined && contextWindow > 0 && input > 0) {
        const pct = Math.round((input / contextWindow) * 100)
        msg += `\nusage: ${pct}%`
      }
      return { kind: 'handled', message: msg }
    }

    case '/exit':
    case '/quit': {
      // Request a process exit through the launcher's bounded host hook.
      const exit = appExit(cmd.ctx)
      if (exit !== undefined) exit(0)
      else process.exit(0)
      return { kind: 'exit' }
    }

    default:
      return { kind: 'unknown', input: raw }
  }
}

/** Re-export the SessionId constructor for callers that build new sessions. */
export { SessionId }
