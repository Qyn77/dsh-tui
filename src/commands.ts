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
import type { ApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { HistoryPref, UiState } from './types.ts'
import { isHistoryPref } from './types.ts'
import { appExit, service } from './services.ts'
import { readPermissionPreset } from './permissions.ts'
import {
  COMMAND_NAMES,
  catalog,
  parseLanguageArg,
  type Catalog,
  type Lang,
} from './i18n.ts'
import { contextOccupancy, formatUsage, totalUsage, usageByTurn } from './usage.ts'
import { isThemePref, type Appearance, type ThemePref } from './theme.ts'
import { KEYBIND_PREFS, isKeybindPref, type KeybindPref } from './vim.ts'
import {
  MAX_SESSION_ROWS,
  formatSessions,
  shortId,
  summarizeLog,
  type SessionRow,
} from './sessions.ts'
import { EXPANDED_MAX_LINES, PREVIEW_MAX_LINES } from './message-layout.ts'
import type { SwapSession } from './resume.ts'
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
import { describeMcpServers, formatMcpServers, waitForMcpServer } from './mcp.ts'
import { parseMcpSnippet, secretEnvKeys, type McpParseResult } from './mcp-config.ts'
import { addMcpRows, patchPath, removeMcpRow } from './mcp-patch.ts'
import { findPreset, presetRow } from './mcp-catalog.ts'

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
   * `/skill <name> [args]`: the App routes the rewritten `input` (`/<name>
   * [args]`) through the same skill fallback an unknown `/<name>` takes. This
   * module never imports the skill registry, so it cannot resolve the name.
   */
  | { kind: 'skill'; input: string }

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

/**
 * How long `/mcp add` waits for a new server to answer before reporting the
 * write on its own.
 *
 * Long enough for `npx` to fetch a package it has never run, short enough that
 * a server which will never answer does not hold the prompt. A timeout is not
 * a failure — the row is written either way, and `/mcp` tells the truth a
 * moment later.
 */
export const MCP_CONNECT_TIMEOUT_MS = 15_000

/**
 * Add the servers a pasted snippet describes.
 *
 * Split out of `dispatch` for the same reason `togglePlugin` is: the arm is
 * mostly refusals, and each one is a case where writing would have been worse
 * than declining. The order matters — parse before touching the file, check
 * for a duplicate before appending — so that a bad paste never leaves a
 * half-written patch layer behind.
 * @param cmd - the dispatch context.
 * @param payload - everything after `/mcp add`.
 * @param strings - the active catalog's output strings.
 * @returns the transcript answer.
 */
async function addMcpServers(
  cmd: CommandContext,
  payload: string,
  strings: Catalog['output'],
): Promise<CommandResult> {
  if (payload === '') return { kind: 'handled', message: strings.mcpAddUsage }
  // A single word that names a catalog preset is the picker's (or a typed
  // `/mcp add memory`'s) answer: the row comes from `mcp-catalog.ts` rather
  // than from a paste. Anything else — a brace, a multi-word block — goes to
  // the snippet parser unchanged, so the paste path keeps its exact grammar.
  const preset = findPreset(payload)
  const parsed: McpParseResult = preset === undefined
    ? parseMcpSnippet(payload)
    : { kind: 'ok', rows: [presetRow(preset)] }
  if (parsed.kind === 'error') {
    return { kind: 'handled', message: strings.mcpAddInvalid(parsed.error), failed: true }
  }
  const path = patchPath()
  const written = addMcpRows(parsed.rows, path)
  if (written.kind === 'duplicate') {
    return { kind: 'handled', message: strings.mcpAddDuplicate(written.server), failed: true }
  }
  if (written.kind === 'failed') {
    return { kind: 'handled', message: strings.mcpWriteFailed(written.reason), failed: true }
  }
  // From here the row is on disk and the launcher's watcher owns what happens
  // next. Everything below only decides how much of it we managed to observe.
  const tools = service(cmd.ctx, 'tools')
  const counts = await Promise.all(parsed.rows.map(async (row) => {
    if (tools === undefined) return undefined
    return waitForMcpServer(
      row.config.serverName,
      () => tools.schemas(cmd.agent),
      (listener) => {
        const off = cmd.ctx.on('tools/change', listener)
        return () => { off() }
      },
      MCP_CONNECT_TIMEOUT_MS,
    )
  }))

  const lines: string[] = []
  const pending: string[] = []
  parsed.rows.forEach((row, index) => {
    const count = counts[index]
    if (count === undefined) pending.push(row.config.serverName)
    else lines.push(strings.mcpAdded(row.config.serverName, count, path))
  })
  if (pending.length > 0) lines.push(strings.mcpAddPending(pending, path))
  const secrets = parsed.rows.flatMap(row => secretEnvKeys(row.config))
  if (secrets.length > 0) lines.push(strings.mcpAddSecret([...new Set(secrets)]))
  return { kind: 'handled', message: lines.join('\n') }
}

/**
 * Take one server out of the patch layer.
 *
 * Only rows this command could have written are addressable: the lookup is by
 * the derived row id, so a server someone wired up in a bundle layer or with
 * `--patch` reports as missing rather than being silently left in place after
 * a success message.
 * @param payload - everything after `/mcp remove`.
 * @param strings - the active catalog's output strings.
 * @returns the transcript answer.
 */
function removeMcpServer(payload: string, strings: Catalog['output']): CommandResult {
  const server = payload.trim().split(/\s+/)[0] ?? ''
  if (server === '') return { kind: 'handled', message: strings.mcpRemoveUsage }
  const path = patchPath()
  const result = removeMcpRow(server, path)
  if (result.kind === 'missing') {
    return { kind: 'handled', message: strings.mcpRemoveMissing(result.server), failed: true }
  }
  if (result.kind === 'failed') {
    return { kind: 'handled', message: strings.mcpWriteFailed(result.reason), failed: true }
  }
  return { kind: 'handled', message: strings.mcpRemoved(server, path) }
}

/**
 * One session's opening line, or undefined when there is nothing readable.
 *
 * The throw is swallowed on purpose: `inspect` rejects an unknown format
 * version and a corrupt committed prefix, and neither is a reason to withhold
 * the row. See {@link listSessions}.
 */
async function summarize(
  persistence: { inspect: (id: SessionId) => Promise<{ events: readonly SessionEvent[] }> },
  id: SessionId,
): Promise<string | undefined> {
  try {
    const { events } = await persistence.inspect(id)
    return summarizeLog(events)
  } catch {
    return undefined
  }
}

/**
 * Read the store and render the listing.
 *
 * The summary column costs one `inspect` per *listed* row — `list()` is
 * metadata only, with no message text and no count — so the slice happens
 * before the reads and the budget is `MAX_SESSION_ROWS` however large the store
 * is. `inspect` rather than `load`: it commits no recovery and publishes
 * nothing, and an already-live session yields its current snapshot instead of
 * rejecting, which matters because the running session is in the list.
 *
 * A log that cannot be read costs its own summary and nothing else. Losing the
 * whole listing to one corrupt file would strike exactly when the user is
 * hunting for a session to escape to.
 * @param cmd - the dispatch context; `sessionPersistence` is read optionally.
 * @param strings - the active catalog's output strings.
 */
async function listSessions(
  cmd: CommandContext,
  strings: Catalog['output'],
): Promise<CommandResult> {
  const persistence = service(cmd.ctx, 'sessionPersistence')
  if (persistence === undefined) return { kind: 'handled', message: strings.noPersistence }
  const headers = await persistence.list()
  if (headers.length === 0) return { kind: 'handled', message: strings.noStoredSessions }
  const newest = [...headers].sort((a, b) => b.createdAt - a.createdAt)
  const shown = newest.slice(0, MAX_SESSION_ROWS)
  const rows: SessionRow[] = await Promise.all(shown.map(async (header) => {
    const summary = await summarize(persistence, header.id)
    return {
      id: header.id,
      createdAt: header.createdAt,
      ...header.cwd === undefined ? {} : { cwd: header.cwd },
      ...summary === undefined ? {} : { summary },
      current: header.id === cmd.agent.session.id,
    }
  }))
  const table = formatSessions(rows, newest.length - shown.length, strings.sessionLabels)
  return {
    kind: 'handled',
    message: `${strings.sessionsHeading(headers.length)}\n${table}\n\n${strings.sessionsFooter}`,
  }
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
   * Raise or lower how many lines a long tool result or shell output previews.
   * One switch for the whole transcript, not per entry: the app has no focused
   * entry to scope it to. Optional for the same reason as {@link setTheme}.
   */
  setVerbose?: (on: boolean) => void
  /**
   * Whether the raised preview budget is currently in force, defaulting to
   * `false`. Only `/verbose` reads it, to toggle and to say what is in force.
   */
  verbose?: boolean
  /**
   * Switch whether a resumed session's stored history is drawn: repaint now,
   * persist for the next launch. Optional for the same reason as
   * {@link setTheme} — a context without one still reports the switch.
   */
  setHistory?: (pref: HistoryPref) => void
  /**
   * Whether the resumed history is currently drawn, defaulting to `'show'`.
   * `/history` reads it to toggle, and `/resume` reads it to say whether the
   * transcript it just swapped in is on screen.
   */
  historyPref?: HistoryPref
  /**
   * Switch the prompt editor's keymap, backing `/keybinds`. Optional like
   * {@link setTheme} — a context without one still reports the switch.
   */
  setKeybinds?: (pref: KeybindPref) => void
  /** Which keymap the prompt currently runs, defaulting to `'default'`. */
  keybindPref?: KeybindPref
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
  /**
   * Swap the live agent for a stored session, backing `/resume`.
   *
   * Optional like {@link setTheme}: a context without one reports that
   * switching is unavailable rather than throwing. The refusal cases —
   * a running turn, an id that resolves to nothing — are the callee's,
   * because only it can see the agent's status and the store.
   */
  swapSession?: SwapSession
  /** Live UI state for commands that inspect token usage or entries. */
  state: UiState
}

/**
 * Read `/verbose`'s argument. `on` and `off` only — not `true`/`1`/`yes`, and
 * not the theme-style `auto`, because there is nothing to detect.
 * @param raw - the first argument, if there was one.
 * @returns the state asked for, or `undefined` when the word was not one of the two.
 */
function parseVerboseArg(raw: string | undefined): boolean | undefined {
  if (raw === 'on') return true
  if (raw === 'off') return false
  return undefined
}

/**
 * Read `/history`'s argument. `show` and `hide` only — the words are the
 * setting's own values, so what the user types is what lands in
 * `~/.dsh/tui.json`.
 * @param raw - the first argument, if there was one.
 * @returns the preference asked for, or `undefined` when the word was neither.
 */
function parseHistoryArg(raw: string | undefined): HistoryPref | undefined {
  return isHistoryPref(raw) ? raw : undefined
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
      // The permission line is omitted entirely when no projection service is
      // mounted, so an assembly without dsh-permission-presets sees the same
      // two-line report it always did.
      const preset = readPermissionPreset(cmd.ctx, cmd.agent.session)?.currentValue
      return {
        kind: 'handled',
        message: strings.status(model, cmd.agent.id, preset),
      }
    }

    case '/sessions':
      return await listSessions(cmd, strings)

    case '/skill': {
      // Bare `/skill` cannot open the picker — dispatch means the line was
      // submitted, and the picker lives in the buffer — so it prints how to
      // reach it. With an argument it is an explicit invocation, rewritten to
      // `/<name> [args]` and routed through the same skill fallback a typed
      // `/<name>` takes. The name is deliberately not validated here: this
      // module does not depend on the skill registry, and every failure
      // (unknown, model-only, bad grammar, no registry) already collapses to
      // the runner's ordinary unknown-command note.
      const args = raw.trim().split(/\s+/).slice(1)
      if (args.length === 0) return { kind: 'handled', message: strings.skillUsage }
      const after = raw.trim().slice('/skill'.length).replace(/^\s+/, '')
      return { kind: 'skill', input: `/${after}` }
    }

    case '/resume': {
      const args = raw.trim().split(/\s+/).slice(1)
      const request = args[0]
      if (request === undefined) return { kind: 'handled', message: strings.resumeUsage }
      if (cmd.swapSession === undefined) {
        return { kind: 'handled', message: strings.resumeUnavailable }
      }
      const result = await cmd.swapSession(request)
      if (result.kind === 'busy') return { kind: 'handled', message: strings.resumeBusy }
      if (result.kind === 'current') {
        return { kind: 'handled', message: strings.resumeCurrent(shortId(result.id)) }
      }
      if (result.kind === 'refused') return { kind: 'handled', message: result.notice }
      // No count of what came back: the transcript underneath this line is the
      // evidence, and the number the App could cheaply supply is a session
      // event count, which does not equal the rows the user is looking at.
      // Unless the history is hidden — then there is no transcript underneath,
      // and the line has to say so or the screen reads as a failed resume.
      return {
        kind: 'handled',
        message: (cmd.historyPref ?? 'show') === 'hide'
          ? strings.resumeSwitchedHidden(shortId(result.id))
          : strings.resumeSwitched(shortId(result.id)),
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

    case '/verbose': {
      const args = raw.trim().split(/\s+/).slice(1)
      const current = cmd.verbose ?? false
      // Bare `/verbose` toggles rather than printing usage, unlike `/theme`:
      // there are only two states, so a round trip through a usage line to
      // reach the other one would be pure ceremony. Usage is still reachable —
      // it is what a bad argument prints.
      const requested = args.length === 0 ? !current : parseVerboseArg(args[0])
      if (requested === undefined) {
        return {
          kind: 'handled',
          message: strings.verboseUsage(current, PREVIEW_MAX_LINES, EXPANDED_MAX_LINES),
          failed: true,
        }
      }
      cmd.setVerbose?.(requested)
      return {
        kind: 'handled',
        message: strings.verboseSwitched(
          requested,
          requested ? EXPANDED_MAX_LINES : PREVIEW_MAX_LINES,
        ),
      }
    }

    case '/keybinds': {
      const args = raw.trim().split(/\s+/).slice(1)
      const current = cmd.keybindPref ?? 'default'
      // No bare-toggle here, unlike `/history`. Two states again, but these two
      // change what every subsequent keystroke *means*, and a user who typed
      // `/keybinds` to check which one is on must not be switched by the
      // asking. Reading and writing are different requests.
      if (args.length === 0) {
        return { kind: 'handled', message: strings.keybindsUsage(current) }
      }
      const requested = args[0]
      if (!isKeybindPref(requested)) {
        return {
          kind: 'handled',
          message: strings.keybindsUnknown(requested ?? '', KEYBIND_PREFS),
          failed: true,
        }
      }
      cmd.setKeybinds?.(requested)
      return { kind: 'handled', message: strings.keybindsSwitched(requested) }
    }

    case '/history': {
      const args = raw.trim().split(/\s+/).slice(1)
      const current = cmd.historyPref ?? 'show'
      // Bare `/history` toggles, same bargain as `/verbose`: two states, so a
      // usage line on the way between them is ceremony. A bad argument still
      // prints the usage — including what is currently in force.
      const requested = args.length === 0
        ? (current === 'show' ? 'hide' : 'show')
        : parseHistoryArg(args[0])
      if (requested === undefined) {
        return { kind: 'handled', message: strings.historyUsage(current), failed: true }
      }
      cmd.setHistory?.(requested)
      return { kind: 'handled', message: strings.historySwitched(requested) }
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

    case '/approval': {
      // The two policies are written out rather than imported from
      // `APPROVAL_POLICIES`, which is a runtime export: this package depends on
      // `dsh-user-approval` for types only, and a value import would make an
      // assembly that never mounts approval fail to load. `satisfies` is what
      // keeps the copy honest — a third policy makes this line a build error
      // rather than a validator that silently rejects a valid word.
      const policies = ['ask', 'never'] as const satisfies readonly ApprovalPolicy[]
      const approval = service(cmd.ctx, 'approval')
      if (approval === undefined) {
        return { kind: 'handled', message: strings.approvalNoService }
      }
      const args = raw.trim().split(/\s+/).slice(1)
      if (args.length === 0) {
        const override = approval.overrideOf(cmd.agent.session)
        return {
          kind: 'handled',
          message: override === undefined
            ? strings.approvalUsageDefault
            : strings.approvalUsage(override),
        }
      }
      const given = args[0]
      const policy = policies.find(p => p === given)
      if (policy === undefined) {
        return { kind: 'handled', message: strings.approvalUnknown(given, policies) }
      }
      // `setPolicy` rather than `setApprovalPolicy`: the latter appends to the
      // log without telling the live agent, so the model would keep answering
      // under the policy it was last told about.
      approval.setPolicy(cmd.agent, policy)
      return { kind: 'handled', message: strings.approvalSwitched(policy) }
    }

    case '/mcp': {
      // `raw`, not the whitespace-split argv: an added config is a pasted
      // JSON block whose newlines and spacing are part of it. The verb is the
      // only thing this arm tokenises.
      const action = /^\/mcp\s+(add|remove)\b([\s\S]*)$/i.exec(raw.trim())
      if (action !== null) {
        const payload = (action[2] ?? '').trim()
        if ((action[1] ?? '').toLowerCase() === 'add') return await addMcpServers(cmd, payload, strings)
        return removeMcpServer(payload, strings)
      }
      // Read at dispatch time, like every other service-backed command: the
      // bridge re-syncs tool generations on reconnects, so a fresh read is
      // the only honest answer. The scope is the agent — a per-agent tool
      // variant shadows the global one, and `/mcp` should describe what
      // *this* conversation's model can call.
      const tools = service(cmd.ctx, 'tools')
      if (tools === undefined) return { kind: 'handled', message: strings.mcpNoTools }
      const rows = describeMcpServers(tools.schemas(cmd.agent))
      if (rows.length === 0) return { kind: 'handled', message: strings.mcpNone }
      return {
        kind: 'handled',
        message: `${strings.mcpHeading(rows.length)}\n${formatMcpServers(rows, strings.mcpServer)}`,
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
