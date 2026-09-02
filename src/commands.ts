/**
 * Slash command registry and dispatch for the TUI prompt. The same
 * {@link commands} table feeds the in-progress `/` palette (see
 * `SlashPalette.tsx`) and the help text, so the two never drift.
 * Commands are intercepted in the input handler and never reach the
 * model — they own their own UX. The returned status tells the prompt
 * what to do next.
 *
 * Everything this module writes to the screen is language-dependent, so both
 * the table and the dispatcher take a `lang`. It defaults to `'en'` at every
 * boundary: a caller that does not care about localisation — most tests — reads
 * exactly what it read before this parameter existed.
 *
 * The built-in table is not the whole command surface. Plugins register their own
 * human commands on `ctx.commands` — dsh-base mounts `/compact`, `/feedback`
 * and `/goal` that way — so a name this table does not own falls through to
 * that registry before it is called unknown. The table holds only the
 * commands whose behaviour is the TUI's own (view state, process exit, the
 * model selection this surface threads through a ref).
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
import {
  COMMAND_NAMES,
  catalog,
  parseLanguageArg,
  type Lang,
} from './i18n.ts'
import { contextOccupancy, totalUsage } from './usage.ts'

/** What a command decided. */
export type CommandResult =
  /**
   * The command ran and owns its output. `failed` marks an outcome the command
   * itself reports as an error (a registry command settling `kind: 'error'`),
   * as distinct from `unknown`, which means no command ran at all.
   */
  | { kind: 'handled'; message?: string; failed?: boolean }
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
 * Slash command registry, in the given language. Order is the default order in
 * the palette when the buffer is just `/`. Sorted alphabetically by name on
 * filter for stability.
 *
 * Names live in {@link COMMAND_NAMES} and descriptions in the catalog, so a new
 * command cannot ship half-described: the catalog's `commands` map is keyed by
 * that same tuple, and a missing entry fails to compile.
 * @param lang - the interface language to describe the commands in.
 * @returns one row per built-in command, in canonical order.
 */
export function commands(lang: Lang = 'en'): readonly CommandMeta[] {
  const descriptions = catalog(lang).commands
  return COMMAND_NAMES.map(name => ({ name, description: descriptions[name] }))
}

/**
 * Map the plugin registry's commands into palette rows.
 *
 * The registry is the authority on what a plugin command is called and what it
 * says about itself, so nothing is rewritten here beyond the leading `/` this
 * surface's rows carry and the registry's descriptors do not. That includes the
 * language: plugin descriptions are another package's wording and are shown as
 * written, whatever the interface language is. An absent registry is not an
 * error — it means the built-in table is the whole surface.
 * @param ctx - the context to read the registry from.
 * @param agent - the receiving agent, whose scoped definitions shadow globals.
 * @returns one row per effective registry command, registry order preserved.
 */
export function registryCommands(ctx: Context, agent: Agent): CommandMeta[] {
  const registry = service(ctx, 'commands')
  if (registry === undefined) return []
  return registry.list(agent).map(d => ({ name: `/${d.name}`, description: d.description }))
}

/**
 * Merge the built-in table with registry rows, built-ins winning a name
 * collision. `/clear` is this surface's view state and {@link dispatch} handles
 * it before the registry is consulted; a palette that advertised a registry
 * definition of the same name would be describing behaviour that cannot run.
 * @param extra - registry rows, typically from {@link registryCommands}.
 * @param lang - the interface language for the built-in descriptions.
 * @returns the merged table, built-ins first.
 */
function allCommands(extra: readonly CommandMeta[], lang: Lang): CommandMeta[] {
  const own = commands(lang)
  const owned = new Set(own.map(c => c.name.toLowerCase()))
  return [...own, ...extra.filter(c => !owned.has(c.name.toLowerCase()))]
}

/**
 * Return the commands whose names start with `buffer` (case-insensitive).
 * The buffer is expected to start with `/`; an empty result means
 * "no match — hide the palette". Sorted alphabetically so the order
 * is stable across keystrokes.
 * @param buffer - the current prompt buffer, e.g. `/he` or `/`.
 * @param extra - registry rows to offer alongside the built-in table.
 * @param lang - the interface language for the built-in descriptions.
 */
export function filterCommands(
  buffer: string,
  extra: readonly CommandMeta[] = [],
  lang: Lang = 'en',
): CommandMeta[] {
  const query = buffer.toLowerCase()
  if (!query.startsWith('/')) return []
  return allCommands(extra, lang)
    .filter(c => c.name.toLowerCase().startsWith(query))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Pretty-print the command list for `/help`. Two columns, padded so
 * the descriptions line up. Sourced from {@link commands} plus the plugin
 * registry so the help text and the palette describe the same surface.
 *
 * Names are ASCII, so `padEnd` on character count is display-column padding
 * here — unlike the descriptions, which are never padded.
 * @param extra - registry rows to list alongside the built-in table.
 * @param lang - the interface language for the heading and descriptions.
 */
function helpText(extra: readonly CommandMeta[], lang: Lang = 'en'): string {
  const merged = allCommands(extra, lang)
  const nameCol = Math.max(...merged.map(c => c.name.length))
  const rows = [...merged]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `  ${c.name.padEnd(nameCol)}  ${c.description}`)
  // The `!` escape is not a slash command and cannot be in the registry, but
  // `/help` is where a user goes to find out what the prompt accepts.
  return [catalog(lang).output.helpHeading, ...rows, '', catalog(lang).shell.usage].join('\n')
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
  /**
   * Switch the interface language: repaint now, persist for the next launch.
   * Nothing about the conversation changes — this is the chrome's language, not
   * the model's.
   *
   * Optional, like {@link lang}, so a caller that never types `/language` — most
   * tests — builds a context without it. A `/language` line with no handler
   * still reports the switch it could not make, rather than throwing.
   */
  setLanguage?: (lang: Lang) => void
  /**
   * The interface language in force when the command was entered, defaulting to
   * `'en'`. Every message a command returns is written in it, including the one
   * that changes it — with the deliberate exception of `/language`'s success
   * line, which is written in the language just switched *to*, because that is
   * the switch's own proof.
   */
  lang?: Lang
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
  const lang = cmd.lang ?? 'en'
  const strings = catalog(lang).output
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  switch (name) {
    case '/help':
      return {
        kind: 'handled',
        message: helpText(registryCommands(cmd.ctx, cmd.agent), lang),
      }

    case '/clear':
      cmd.resetView()
      // Deliberately silent. Command output is now an entry in the log, so a
      // "View cleared." message would leave the log one entry long — which
      // both contradicts what the user just watched happen and keeps the
      // banner from returning, since it renders only on an empty log.
      return { kind: 'handled' }

    case '/status': {
      const selection = service(cmd.ctx, 'agentDefaultModel')?.currentSelection()
      const model = selection ? `${selection.provider}/${selection.model}` : strings.unknown
      return {
        kind: 'handled',
        message: strings.status(model, cmd.agent.id),
      }
    }

    case '/language': {
      const args = raw.trim().split(/\s+/).slice(1)
      if (args.length === 0) {
        return { kind: 'handled', message: strings.languageUsage(lang) }
      }
      const requested = parseLanguageArg(args[0])
      if (requested === undefined) {
        return { kind: 'handled', message: strings.unknownLanguage(args[0]), failed: true }
      }
      cmd.setLanguage?.(requested)
      // Written in the language just switched to: the confirmation is itself
      // the first thing the user reads in the new language, so a reader who
      // typed the wrong code sees that immediately rather than being told in
      // a language they cannot check.
      return { kind: 'handled', message: catalog(requested).output.languageSwitched }
    }

    case '/model': {
      const args = raw.trim().split(/\s+/).slice(1)
      const selection = service(cmd.ctx, 'agentDefaultModel')?.currentSelection()
      if (args.length === 0) {
        const model = selection ? `${selection.provider}/${selection.model}` : strings.unknown
        return { kind: 'handled', message: strings.modelUsage(model) }
      }
      if (!selection) {
        return { kind: 'handled', message: strings.noModelService }
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
      return { kind: 'handled', message: strings.modelSwitched(provider, model) }
    }

    case '/context': {
      const selection = service(cmd.ctx, 'agentDefaultModel')?.currentSelection()
      const model = selection ? `${selection.provider}/${selection.model}` : strings.unknown
      // Read the latest advertised context window from the session's
      // request-context fold. This is the provider-advertised capacity,
      // not the model's actual limit — the adapter may have a different
      // ceiling at dispatch time.
      const contextWindow = cmd.agent.session.requestContext()?.contextWindow
      const contextStr
        = contextWindow !== undefined ? contextWindow.toLocaleString() : strings.unknown
      // Two different numbers, and telling them apart is the whole point of
      // this report. `totalUsage` is cumulative spend across every turn;
      // `contextOccupancy` reads the newest turn alone, which is the only one
      // that answers "how full is the window". Dividing the cumulative sum by
      // the window — which this did — climbs past 100% on a long session and
      // can never come back down after a `/compact`.
      const { input, output } = totalUsage(cmd.state)
      const occupied = contextOccupancy(cmd.state)
      const usable = contextWindow !== undefined && contextWindow > 0 && occupied !== undefined
      return {
        kind: 'handled',
        message: strings.context({
          model,
          contextWindow: contextStr,
          input: input.toLocaleString(),
          output: output.toLocaleString(),
          ...(occupied === undefined ? {} : { inContext: occupied.toLocaleString() }),
          ...(usable ? { usagePercent: Math.round((occupied / contextWindow) * 100) } : {}),
        }),
      }
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
      return await runRegistryCommand(raw, cmd)
  }
}

/**
 * Try the plugin-owned command registry for a name {@link commands} does not
 * hold. `ctx.commands.execute` parses the line itself and returns `undefined`
 * when the name resolves to nothing, which is exactly this surface's `unknown`.
 *
 * The registry logs `command/run`/`command/done` around the handler, so a
 * command that runs this way is already in the session log before its text
 * reaches the view. Appending the returned text is presentation, not the
 * record.
 *
 * The signal is a fresh controller nothing aborts yet. The TUI's Ctrl+C path
 * interrupts the agent's turn, and a command is not a turn — giving it real
 * cancellation means deciding what a half-cancelled command shows, which is a
 * change with its own UX question. A controller is passed rather than a
 * detached `new AbortController().signal` so that wiring is a one-line change
 * here when it happens.
 * @param raw - the raw input line, including the leading `/`.
 * @param cmd - the dispatch context.
 * @returns the registry's outcome, or `unknown` when no command matched.
 */
async function runRegistryCommand(raw: string, cmd: CommandContext): Promise<CommandResult> {
  const registry = service(cmd.ctx, 'commands')
  if (registry === undefined) return { kind: 'unknown', input: raw }
  const controller = new AbortController()
  const execution = await registry.execute(cmd.agent, raw.trim(), controller.signal)
  if (execution === undefined) return { kind: 'unknown', input: raw }
  const { result } = execution
  if (result.kind === 'error') return { kind: 'handled', message: result.text, failed: true }
  // A successful command may carry no text — `/compact` points at the
  // `compaction/end` event instead, which the message list already renders.
  return { kind: 'handled', message: result.text }
}

/** Re-export the SessionId constructor for callers that build new sessions. */
export { SessionId }
