/**
 * Slash command registry and dispatch for the TUI prompt. The same
 * `COMMANDS` table feeds the in-progress `/` palette (see
 * `SlashPalette.tsx`) and the help text, so the two never drift.
 * Commands are intercepted in the input handler and never reach the
 * model — they own their own UX. The returned status tells the prompt
 * what to do next.
 * @module @deepseek-ai/dsh-tui/commands
 */

import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  CURRENT_MARK,
  formatRoutes,
  formatSelection,
  parseRouteArg,
  resolveRoute,
  type ModelRoute,
} from './model.ts'

/** What a command decided. */
export type CommandResult =
  | {
      kind: 'handled'
      message?: string
      /**
       * The model the agent will use from the next step on, when this
       * command changed it. The UI reads this rather than re-reading the
       * default-model service, so the status bar shows what the agent
       * actually routes to even if persisting the new default failed.
       */
      selection?: ModelSelection
    }
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
  { name: '/model', description: 'Show the model catalog, or switch to provider/model' },
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
  /**
   * The live agent's mutable model selection. Writing `current` is what
   * actually re-routes the running agent: prompt assembly snapshots this
   * ref when a step begins, so a switch lands on the next step rather
   * than tearing the current one in half. Saving the default-model
   * setting only affects agents created later, so `/model` has to do
   * both — this for now, the setting for next launch.
   */
  selectionRef?: ModelSelectionRef
}

/**
 * Read every provider's advertised catalog. Failures are swallowed per
 * provider: one adapter with a broken or unreachable model endpoint
 * should cost the user that provider's rows, not the whole listing.
 * @param ctx - context carrying the `llm` runtime.
 * @param providers - registered provider routes.
 */
async function readCatalog(ctx: Context, providers: readonly string[]): Promise<ModelRoute[]> {
  const llm = ctx.get('llm')
  if (llm === undefined) return []
  const settled = await Promise.allSettled(providers.map((p) => llm.listModels(p)))
  const routes: ModelRoute[] = []
  for (const [i, result] of settled.entries()) {
    if (result.status !== 'fulfilled') continue
    const provider = providers[i] as string
    for (const info of result.value) routes.push({ provider, model: info.id, name: info.name })
  }
  return routes
}

/**
 * `/model` — with no argument, print the current selection and the
 * catalog; with one, switch to it.
 *
 * Switching writes two places for two different lifetimes: the live
 * agent's selection ref (effective next step) and the default-model
 * setting (effective next launch). A failure to persist is reported
 * rather than swallowed, because a user told "switched" who finds the
 * old model back after a restart has been lied to.
 *
 * The reasoning effort is deliberately *not* carried across a switch.
 * Effort ids are adapter-owned and scoped to one exact route, so
 * reusing the old model's id on a new model would at best be rejected
 * and at worst silently mean something else. Dropping it restores the
 * new model's provider default.
 * @param rest - the argument text after `/model`.
 * @param cmd - the dispatch context.
 */
async function modelCommand(rest: string, cmd: CommandContext): Promise<CommandResult> {
  const defaults = cmd.ctx.get('agentDefaultModel')
  if (defaults === undefined) {
    return { kind: 'handled', message: 'model selection is unavailable in this deployment' }
  }
  const current = cmd.selectionRef?.current ?? defaults.currentSelection()
  const providers = cmd.ctx.get('llm')?.listProviders().map((p) => p.id) ?? []

  const arg = parseRouteArg(rest)
  if (arg === undefined) {
    const catalog = await readCatalog(cmd.ctx, providers)
    return {
      kind: 'handled',
      message: [
        `current: ${formatSelection(current)}`,
        '',
        `available (${CURRENT_MARK} = current):`,
        formatRoutes(catalog, providers, current),
        '',
        'switch with: /model <provider>/<model>',
      ].join('\n'),
    }
  }

  const catalog = await readCatalog(
    cmd.ctx,
    // Only the named provider's catalog matters when the prefix is a
    // registered route: the lookup exists to decide whether to warn
    // "unlisted", and interrogating every other provider's endpoint to
    // answer that would make an unambiguous switch pay for all of them.
    // An unrecognised prefix does need the full catalog — it might be
    // the first half of a slashed model id.
    arg.provider !== undefined && providers.includes(arg.provider) ? [arg.provider] : providers,
  )
  const resolved = resolveRoute(arg, catalog, providers, current.provider)
  if (resolved.kind === 'invalid') {
    return { kind: 'handled', message: `/model: ${resolved.reason}` }
  }
  if (resolved.kind === 'ambiguous') {
    const options = resolved.providers.map((p) => `  /model ${p}/${resolved.model}`)
    return {
      kind: 'handled',
      message: [`/model: ${resolved.model} is advertised by several providers:`, ...options].join('\n'),
    }
  }

  const next: ModelSelection = { provider: resolved.provider, model: resolved.model }
  if (cmd.selectionRef !== undefined) cmd.selectionRef.current = next

  const lines = [`model: ${formatSelection(current)} → ${formatSelection(next)}`]
  if (!resolved.listed) {
    lines.push(`note: ${resolved.model} is not in ${resolved.provider}'s advertised catalog.`)
  }
  if (current.reasoningEffort !== undefined) {
    lines.push('note: reasoning effort reset to the new model\'s default.')
  }
  try {
    await defaults.saveSelection(next)
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    lines.push(`warning: not saved as the default for future sessions (${reason}).`)
  }
  return { kind: 'handled', message: lines.join('\n'), selection: next }
}

/**
 * Dispatch a `/...` line to its handler. The trailing whitespace is trimmed;
 * a leading `/` is required. Anything unknown returns `kind: 'unknown'`.
 *
 * Asynchronous because `/model` reads provider catalogs and writes a
 * setting. Commands that need no I/O still return immediately — the
 * `await` at the call site costs one microtask, not a frame.
 * @param raw - the raw input line, including the leading `/`.
 * @param cmd - the dispatch context.
 * @returns what the caller should do next.
 */
export async function dispatch(raw: string, cmd: CommandContext): Promise<CommandResult> {
  const trimmed = raw.trim()
  const name = trimmed.split(/\s+/)[0]?.toLowerCase() ?? ''
  switch (name) {
    case '/help':
      return { kind: 'handled', message: helpText() }

    case '/clear':
      cmd.resetView()
      return { kind: 'handled', message: 'View cleared.' }

    case '/model':
      return await modelCommand(trimmed.slice(name.length), cmd)

    case '/status': {
      const selection = cmd.selectionRef?.current ?? cmd.ctx.get('agentDefaultModel')?.currentSelection()
      const model = selection ? formatSelection(selection) : 'unknown'
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
