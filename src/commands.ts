/**
 * Slash command registry and dispatch for the TUI prompt. The same
 * `COMMANDS` table feeds the in-progress `/` palette (see
 * `SlashPalette.tsx`) and the help text, so the two never drift.
 * Commands are intercepted in the input handler and never reach the
 * model — they own their own UX. The returned status tells the prompt
 * what to do next.
 * @module @deepseek-ai/dsh-tui/commands
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'

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
  { name: '/exit', description: 'Leave the REPL' },
  { name: '/help', description: 'Show the list of available commands' },
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
    .filter((c) => c.name.toLowerCase().startsWith(query))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Pretty-print the command list for `/help`. Two columns, padded so
 * the descriptions line up. Sourced from {@link COMMANDS} so the two
 * surfaces stay in lock-step.
 */
function helpText(): string {
  const nameCol = Math.max(...COMMANDS.map((c) => c.name.length))
  const rows = [...COMMANDS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `  ${c.name.padEnd(nameCol)}  ${c.description}`)
  return ['Available commands:', ...rows].join('\n')
}

/** Snapshot one command from the registry. */
export interface CommandContext {
  ctx: Context
  agent: Agent
  /** Reset the visible chat to an empty list. */
  resetView: () => void
}

/**
 * Dispatch a `/...` line to its handler. The trailing whitespace is trimmed;
 * a leading `/` is required. Anything unknown returns `kind: 'unknown'`.
 * @param raw - the raw input line, including the leading `/`.
 * @param cmd - the dispatch context.
 * @returns what the caller should do next.
 */
export function dispatch(raw: string, cmd: CommandContext): CommandResult {
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  switch (name) {
    case '/help':
      return { kind: 'handled', message: helpText() }

    case '/clear':
      cmd.resetView()
      return { kind: 'handled', message: 'View cleared.' }

    case '/status': {
      const selection = cmd.ctx.get('agentDefaultModel')?.currentSelection()
      const model = selection ? `${selection.provider}/${selection.model}` : 'unknown'
      return {
        kind: 'handled',
        message: `model: ${model}\nsession: ${cmd.agent.id}`,
      }
    }

    case '/exit':
    case '/quit': {
      // Request a process exit through the launcher's bounded host hook.
      const exit = cmd.ctx.get('appExit')
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
