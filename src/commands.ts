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
  type Catalog,
  type Lang,
} from './i18n.ts'
import { contextOccupancy, formatUsage, totalUsage, usageByTurn } from './usage.ts'
import { isThemePref, type Appearance, type ThemePref } from './theme.ts'
import {
  OSC52_MAX_BYTES,
  byteLength,
  clampForClipboard,
  multiplexerFromEnv,
  osc52,
  pickCopyText,
  type CopyTarget,
} from './clipboard.ts'
import {
  describePlugins,
  formatPlugins,
  parsePluginArgs,
  resolvePlugin,
  type PluginRow,
} from './plugins.ts'

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

/**
 * The one loader capability `/plugins` writes through.
 *
 * Named structurally so this module states exactly what it does to the user's
 * config — one field of one entry — rather than accepting the whole `EntryTree`
 * and leaving the reader to check. `disabled: null` deletes the key instead of
 * writing `false`, which keeps a re-enabled plugin's config the shape it had
 * before anyone typed `/plugins disable`.
 */
interface PluginSwitch {
  update: (id: string, options: { disabled?: boolean | null }) => Promise<void>
}

/**
 * Apply an `enable`/`disable` to one row.
 *
 * Split out of `dispatch` because the interesting part is the refusals, and a
 * `case` arm long enough to hide them is how a footgun ships. Everything here
 * either declines with a reason or performs exactly one write.
 */
async function togglePlugin(
  loader: PluginSwitch,
  rows: readonly PluginRow[],
  action: { enable: boolean; query: string },
  strings: Catalog['output'],
): Promise<CommandResult> {
  const match = resolvePlugin(rows, action.query)
  if (match.kind === 'none') {
    return { kind: 'handled', message: strings.pluginNotFound(action.query), failed: true }
  }
  if (match.kind === 'ambiguous') {
    return {
      kind: 'handled',
      message: strings.pluginAmbiguous(action.query, match.names),
      failed: true,
    }
  }
  const { row } = match
  if (action.enable === (row.phase !== 'disabled')) {
    return { kind: 'handled', message: strings.pluginUnchanged(row.name, action.enable) }
  }
  // A lock is a refusal, not a failure of the loader: each one is a case where
  // writing the flag would either destroy something the user wrote or leave
  // them with no way back. See `PluginLock`.
  if (row.lock === 'self' && !action.enable) {
    return { kind: 'handled', message: strings.pluginLockedSelf(row.name), failed: true }
  }
  if (row.lock === 'expression') {
    return { kind: 'handled', message: strings.pluginLockedExpression(row.name), failed: true }
  }
  if (row.lock === 'inherited' && action.enable) {
    return { kind: 'handled', message: strings.pluginLockedInherited(row.name), failed: true }
  }
  try {
    // `update` starts or stops the plugin *and* rewrites the config file, so a
    // throw here can mean either half failed. The message says which plugin
    // and repeats the loader's own reason rather than inventing one.
    await loader.update(row.id, { disabled: action.enable ? null : true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      kind: 'handled',
      message: strings.pluginToggleFailed(row.name, reason),
      failed: true,
    }
  }
  return { kind: 'handled', message: strings.pluginToggled(row.name, action.enable) }
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
  /**
   * Switch which background the colors assume: repaint now, persist for the
   * next launch. Optional for the same reason as {@link setLanguage}.
   */
  setTheme?: (pref: ThemePref) => void
  /**
   * What the user last asked for, defaulting to `'auto'`. Only `/theme` reads
   * it, to say what the current setting is.
   */
  themePref?: ThemePref
  /**
   * Which way the background actually reads — the probe's answer under `auto`,
   * or the explicit choice otherwise. Defaults to `'dark'`, which is both the
   * app's own default and what a context built without it should report.
   */
  appearance?: Appearance
  /**
   * Write a control sequence straight to the terminal.
   *
   * Named for what it does rather than for `/copy`, because that is the whole of
   * its contract: this module decides *what* to send and builds the bytes, and
   * the App only supplies a writer. Optional like {@link setTheme} — a context
   * without one still reports what it could not send.
   *
   * It must be Ink's own writer, not `process.stdout.write`. See the App's
   * wiring for why: Ink re-emits its cached frame afterwards, so a terminal that
   * renders an unrecognised OSC as visible garbage has it erased immediately.
   */
  emit?: (sequence: string) => void
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

    // Read fresh, never cached: cordis keeps `Entry.fiber` and `Fiber.state`
    // current through its own events, so any copy kept here could only go
    // stale. `loader` is optional because an embedded assembly can construct
    // the context by hand — that is a missing feature, not a failure, so it
    // reports rather than throws.
    case '/plugins': {
      const loader = service(cmd.ctx, 'loader')
      if (loader === undefined) return { kind: 'handled', message: strings.noLoader }
      const action = parsePluginArgs(raw.trim().split(/\s+/).slice(1))
      if (action.kind === 'usage') return { kind: 'handled', message: strings.pluginUsage }
      const rows = describePlugins(loader.entries())
      if (action.kind === 'list') {
        if (rows.length === 0) return { kind: 'handled', message: strings.noPlugins }
        return {
          kind: 'handled',
          message: `${strings.pluginsHeading(rows.length)}\n${formatPlugins(rows, strings.pluginPhases)}`,
        }
      }
      return await togglePlugin(loader, rows, action, strings)
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

    case '/theme': {
      const args = raw.trim().split(/\s+/).slice(1)
      const pref = cmd.themePref ?? 'auto'
      const appearance = cmd.appearance ?? 'dark'
      if (args.length === 0) {
        return { kind: 'handled', message: strings.themeUsage(pref, appearance) }
      }
      const requested = args[0]
      if (!isThemePref(requested)) {
        return {
          kind: 'handled',
          message: strings.unknownTheme(requested),
          failed: true,
        }
      }
      cmd.setTheme?.(requested)
      // `auto` reports what the terminal said, because "auto" alone does not
      // tell the user whether the answer they are about to see is the one they
      // wanted — and the whole reason to type `/theme` is that it might not be.
      return {
        kind: 'handled',
        message: strings.themeSwitched(requested, requested === 'auto' ? appearance : requested),
      }
    }

    case '/copy': {
      const args = raw.trim().split(/\s+/).slice(1)
      // Exactly two forms, and an unrecognised argument is the usage line rather
      // than a guess. `/copy code` is one keystroke from `/copy codee`, and
      // silently copying the whole reply instead would be discovered on paste.
      const target: CopyTarget | undefined =
        args.length === 0 ? 'reply' : args[0] === 'code' && args.length === 1 ? 'code' : undefined
      if (target === undefined) {
        return { kind: 'handled', message: strings.copyUsage, failed: true }
      }
      const found = pickCopyText(cmd.state.entries, target)
      if (found === undefined) {
        return { kind: 'handled', message: strings.copyNothing(target), failed: true }
      }
      const clamped = clampForClipboard(found.text)
      cmd.emit?.(osc52(clamped.text, { multiplexer: multiplexerFromEnv() }))
      return {
        kind: 'handled',
        message: strings.copySent(
          target,
          byteLength(clamped.text),
          clamped.truncated ? OSC52_MAX_BYTES : undefined,
        ),
      }
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

    // Deliberately a separate command from `/context` rather than more lines
    // inside it. `/context` answers "how full is the window" — one number about
    // now; this answers "where did the tokens go" — a history. Merging them
    // would put a table under a gauge and bury the gauge.
    case '/usage': {
      const turns = usageByTurn(cmd.state)
      if (turns.length === 0) return { kind: 'handled', message: strings.noUsage }
      return {
        kind: 'handled',
        message: `${strings.usageHeading(turns.length)}\n${formatUsage(turns, strings.usageLabels)}`,
      }
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
