/**
 * Pure layout decisions for the conversation surface.
 *
 * Everything here is a string-in/string-out function or a constant, so the
 * conversation's *appearance* can be tested without mounting Ink. That split
 * matters more than usual for this file: `scroll.ts` estimates each entry's
 * rendered height to decide how much history to mount, and an estimate that
 * drifts from what the components actually draw makes old messages
 * unreachable. Both sides read their width and their one-line summaries from
 * here, so `estimateEntryRows` counts the same strings `MessageList` renders
 * rather than a second guess at them.
 * @module @deepseek-ai/dsh-tui/message-layout
 */

import type { ContentBlock, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ToolStatus, UiEntry } from './types.ts'

/**
 * Glyph column width, in cells — the glyph plus one space.
 *
 * Every entry kind renders its marker in a fixed-width column and its body in
 * the column beside it, which is what gives wrapped text a hanging indent
 * instead of sliding back under the marker.
 */
export const GUTTER_WIDTH = 2

/** Marks a turn the assistant produced. */
export const ASSISTANT_GLYPH = '⏺'
/** Marks a line the user typed. */
export const USER_GLYPH = '>'
/** Marks a tool's outcome, hanging under the call it belongs to. */
export const RESULT_GLYPH = '⎿'
/** Marks a lifecycle note — compaction, plan mode, injected context. */
export const NOTE_GLYPH = '⤷'
/** Marks one image attached to the user's message. */
export const ATTACHMENT_GLYPH = '⧉'

/**
 * Checkbox per task-list state.
 *
 * Three glyphs rather than two, because `in_progress` is the one the user
 * actually scans for: a filled box would make it read as finished, and an empty
 * one would make it read as untouched. The arrow is the only one of the three
 * that points at something.
 */
export const TODO_GLYPH: Record<'pending' | 'in_progress' | 'completed', string> = {
  pending: '☐',
  in_progress: '▸',
  completed: '☑',
}

/**
 * Color per task-list state. Only `in_progress` is drawn undimmed — see
 * `TodoList` in `components/MessageList.tsx`, which pairs these with
 * `dimColor` so the current task is the one thing that stands out.
 */
export const TODO_COLOR: Record<'pending' | 'in_progress' | 'completed', string> = {
  pending: 'gray',
  in_progress: 'yellow',
  completed: 'green',
}

/**
 * Color of the frame around a user message. The same `blue` as
 * {@link USER_GLYPH}, so the marker and the box it opens read as one thing.
 */
export const USER_BORDER_COLOR = 'blue'

/**
 * Columns a user message's frame takes away from its text: one border cell
 * and one padding cell on each side.
 *
 * Shared rather than written twice because `MessageList` draws the box and
 * `scroll.ts` has to predict how tall it came out. Two copies of this number
 * would disagree the first time either side changed its padding, and the
 * symptom would be unreachable history rather than a wrong-looking box —
 * see `estimateEntryRows` in `scroll.ts`.
 */
export const USER_FRAME_COLUMNS = 4

/** Longest tool argument summary shown inline, in characters. */
const ARGS_MAX = 60

/**
 * Lines of a long output drawn before the rest is counted away.
 *
 * Eight is chosen against the transcript, not against the output: a tool result
 * is one entry among many, and a preview tall enough to answer "did it work,
 * and roughly how" is worth more than one tall enough to answer "what exactly
 * did it say". The full text is never the terminal's job — it went to the
 * model, which is what asked for it.
 */
export const PREVIEW_MAX_LINES = 8

/**
 * Lines a preview may draw once the user has asked to see more.
 *
 * A raised cap rather than no cap, and the reason is layout cost rather than
 * taste. `scroll.ts`'s `windowStart` keeps at least `MIN_MOUNTED_ENTRIES`
 * mounted no matter how many rows they come to, so an uncapped preview means
 * twenty entries times however long a `Read` of a large file was — tens of
 * thousands of Ink `Text` nodes, laid out on every frame. The 8-line cap is
 * what makes that impossible today, and lifting it entirely would trade a
 * truncation complaint for a frozen UI.
 *
 * 200 is about four screens of one result, which is enough to answer "what
 * exactly did it say" — the question the 8-line preview cannot. Past it the
 * withheld-lines marker still appears, so nothing is ever silently dropped.
 */
export const EXPANDED_MAX_LINES = 200

/**
 * The preview budget in force.
 *
 * The single place the expand flag becomes a number. `scroll.ts` measures with
 * it and `MessageList` draws with it, and those two counts must agree exactly
 * or paging stops being invertible — so they read the budget from here rather
 * than each deciding what "expanded" means.
 */
export function previewLimit(expanded: boolean): number {
  return expanded ? EXPANDED_MAX_LINES : PREVIEW_MAX_LINES
}

/**
 * A long output reduced to the rows a transcript can spare.
 *
 * Deliberately **not** a string. The count of withheld lines has to be spoken
 * in the user's language, and `scroll.ts` measures this entry without knowing
 * which catalog is loaded — so the number travels as a number and the renderer
 * says it in words. This is the same split `shellStatusKinds` uses, and for the
 * same reason: a language-dependent string that the measurement has to predict
 * is how the old `(+N more)` locked itself into English (§3.10).
 */
export interface OutputPreview {
  /** The lines to draw. Each occupies exactly one row — see {@link previewRows}. */
  readonly lines: readonly string[]
  /** How many lines were withheld. `0` when the whole output is shown. */
  readonly hidden: number
}

/**
 * Rows a preview occupies: one per shown line, plus one for the marker.
 *
 * Exact rather than approximate, and exact in a way that does not depend on the
 * terminal's width or the interface language — which is only true because the
 * renderer draws every one of these rows `wrap="truncate"`. Change that and
 * this function starts lying, which breaks paging rather than the preview.
 */
export function previewRows(preview: OutputPreview): number {
  return preview.lines.length + (preview.hidden > 0 ? 1 : 0)
}

/**
 * Cut a block of text down to a previewable number of lines.
 *
 * Blank lines are dropped before the cut, not after: a result padded with empty
 * rows would otherwise spend its whole budget on nothing and report the content
 * as hidden. Interior indentation is kept — it is most of what makes code and
 * diff output readable — and only trailing whitespace is trimmed, since a line
 * is drawn truncated and trailing blanks would push the visible text out of the
 * frame for no reason.
 * @param text - the raw output.
 * @param maxLines - rows the preview may occupy before withholding the rest.
 * @returns the lines to draw and the count withheld.
 */
export function outputPreview(text: string, maxLines: number = PREVIEW_MAX_LINES): OutputPreview {
  const limit = Math.max(1, maxLines)
  const lines = text
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line !== '')
  if (lines.length <= limit) return { lines, hidden: 0 }
  return { lines: lines.slice(0, limit), hidden: lines.length - limit }
}

/**
 * Argument keys worth showing as a tool call's subject, best first.
 *
 * A tool call reads as `Read(src/scroll.ts)` only when the *interesting*
 * argument is the one displayed, and which key that is depends on the tool.
 * Rather than special-casing tool names — this package does not own the tool
 * registry and cannot enumerate it — the summary prefers the keys that
 * conventionally carry a subject, then falls back to the first string
 * argument.
 */
const SUBJECT_KEYS = [
  'file_path',
  'path',
  'command',
  'pattern',
  'query',
  'url',
  'name',
  'prompt',
] as const

/** Collapse whitespace so a multi-line argument stays on one row. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Shorten to `max` characters, marking the cut with an ellipsis.
 * @param text - the text to shorten.
 * @param max - the maximum length of the result, including the ellipsis.
 * @returns the text unchanged when it already fits.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/**
 * Split an MCP tool's registered name into the server that provides it and the
 * name that server calls it.
 *
 * `@deepseek-ai/dsh-mcp-client` registers every tool it bridges as
 * `mcp__<serverName>__<rawName>`, one plugin instance per server. That prefix
 * is the *only* trace of MCP the TUI ever sees: the plugin publishes no
 * service, declares no session events, and its tools arrive on `tool/call`
 * indistinguishable from a built-in except by the shape of the name. So this
 * parses the convention rather than querying anything, and needs no dependency
 * on the plugin — which is what lets an assembly that never mounts MCP and one
 * that mounts six servers both render correctly.
 *
 * The split is deliberately conservative. `serverName` is constrained to
 * `[A-Za-z0-9_-]{1,32}` upstream, but a *raw* name may itself contain `__`, so
 * only the first separator after the prefix is honoured and everything past it
 * is the tool's own name. A name that merely starts with `mcp__` but has no
 * second separator is not an MCP tool and is returned untouched: guessing would
 * mislabel a built-in as remote, and the label's whole job is to say where a
 * call is going.
 * @param name - the tool's registered name.
 * @returns the server when the name follows the convention, and the tool name
 * to display either way.
 */
export function parseToolName(name: string): { server?: string; tool: string } {
  const PREFIX = 'mcp__'
  if (!name.startsWith(PREFIX)) return { tool: name }
  const rest = name.slice(PREFIX.length)
  const cut = rest.indexOf('__')
  if (cut <= 0 || cut === rest.length - 2) return { tool: name }
  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) }
}

/**
 * Render a tool call as `name(subject)`, or `server:name(subject)` for a tool
 * bridged from an MCP server.
 *
 * The qualified form is not decoration: two servers may each provide a
 * `search`, and the registered name is the only thing that tells them apart.
 * `server:tool` says the same thing as `mcp__server__tool` in a third of the
 * width, and puts the part the user is scanning for at the end rather than
 * behind two runs of underscores.
 *
 * `args` arrives as the raw JSON string the model emitted, which means it may
 * be malformed — a truncated stream or a model that fumbled the schema both
 * produce something `JSON.parse` rejects. That is a display concern, not an
 * error worth surfacing here, so an unparseable payload degrades to a
 * collapsed, truncated form of the raw text.
 * @param name - the tool's registered name.
 * @param args - the call's arguments as a JSON string; may be empty or invalid.
 * @returns a single-line label, always non-empty.
 */
export function toolCallSummary(name: string, args: string): string {
  const { server, tool } = parseToolName(name)
  const subject = toolCallSubject(args)
  const label = server === undefined ? tool : `${server}:${tool}`
  return subject === '' ? label : `${label}(${subject})`
}

/**
 * Pick the one argument value that best identifies a call.
 * @param args - the call's arguments as a JSON string.
 * @returns the chosen value, collapsed and truncated, or `''` when there is none.
 */
function toolCallSubject(args: string): string {
  const trimmed = args.trim()
  if (trimmed === '') return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Not JSON — show the raw payload rather than nothing, since it is still
    // the only description of the call the user has.
    return truncate(oneLine(trimmed), ARGS_MAX)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return truncate(oneLine(String(parsed)), ARGS_MAX)
  }
  const record = parsed as Record<string, unknown>
  for (const key of SUBJECT_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return truncate(oneLine(value), ARGS_MAX)
    }
  }
  // No conventional subject key: fall back to the first string argument, in
  // declaration order, so at least *something* distinguishes two calls to the
  // same tool.
  for (const value of Object.values(record)) {
    if (typeof value === 'string' && value.trim() !== '') {
      return truncate(oneLine(value), ARGS_MAX)
    }
  }
  return ''
}

/**
 * Reduce a tool result to the rows a transcript can spare.
 *
 * A `ToolResultMessage` carries exactly one `tool-result` block, and the text
 * the user wants is inside *that* block's content — not in the message's own
 * content array. Reading only the outer level finds nothing, ever, which is
 * how tool results came to render as an empty row.
 *
 * This used to return a single line, which meant a `Read` of a 200-line file
 * showed its first line and withheld the other 199 with no way to see them. It
 * still withholds them — the terminal is not where a file gets read — but it
 * now shows enough to recognize what came back.
 * @param message - the result message the tool returned.
 * @param maxLines - rows the preview may occupy.
 * @returns the lines to draw and the count withheld; both empty when the result carries no text.
 */
export function toolResultPreview(
  message: ToolResultMessage,
  maxLines: number = PREVIEW_MAX_LINES,
): OutputPreview {
  return outputPreview(resultText(message.content), maxLines)
}

/**
 * Concatenate the text a result's blocks carry, one nesting level deep.
 *
 * Only text blocks say anything a terminal can show; other block types are
 * dropped rather than described, because a placeholder like `[image]` costs a
 * row without telling the user more than the tool's name already did.
 * @param blocks - content blocks from a result message or a `tool-result` block.
 * @returns the concatenated text, possibly empty.
 */
function resultText(blocks: readonly ContentBlock[]): string {
  let text = ''
  for (const block of blocks) {
    if (block.type === 'text') text += block.text
    else if (block.type === 'tool-result') text += resultText(block.content)
  }
  return text
}

/** Status marker for a tool call. Glyphs are fixed by `docs/SPEC.md` §1.4. */
export function toolStatusGlyph(status: ToolStatus): string {
  switch (status) {
    case 'ok':
      return '✓'
    case 'error':
      return '✗'
    case 'running':
      return '…'
    case 'cancelled':
      return '⊘'
  }
}

/** The `!` sigil drawn in front of a shell escape's echoed command. */
export const SHELL_GLYPH = '!'

/**
 * A shell entry's outcome, as the pieces a status row is built from. Returns an
 * empty array when there is nothing to say — a command that exited `0` with all
 * of its output intact reports success by having worked.
 *
 * The pieces are returned rather than joined so the renderer can localize each
 * one; what matters here is that **the count of status rows does not depend on
 * the language**. That is why {@link shellStatusRows} can be honest about a
 * shell entry's height without `scroll.ts` ever knowing which catalog is in
 * force — the trap that `(+N more)` fell into (see `docs/SPEC.md` §3.10).
 */
export function shellStatusKinds(entry: Extract<UiEntry, { kind: 'shell' }>): ShellStatusKind[] {
  const kinds: ShellStatusKind[] = []
  if (entry.timedOut) kinds.push('timedOut')
  if (entry.signal !== undefined) kinds.push('signalled')
  else if (entry.exitCode !== null && entry.exitCode !== 0) kinds.push('exit')
  if (entry.truncated) kinds.push('truncated')
  if (entry.injected) kinds.push('injected')
  return kinds
}

/** Discriminators for the parts of a shell entry's status row. */
export type ShellStatusKind = 'timedOut' | 'signalled' | 'exit' | 'truncated' | 'injected'

/**
 * Rows a shell entry's status occupies: one, or none.
 *
 * Never more than one, because the renderer draws that row truncated rather
 * than wrapped. The row can contain a path (`cwd: …`), and a path is exactly
 * the kind of string that wraps at a narrow width — so wrapping it would make
 * this count depend on the terminal width *and* on the language, and a row
 * count that disagrees with what is drawn is what breaks paging.
 */
export function shellStatusRows(entry: Extract<UiEntry, { kind: 'shell' }>): 0 | 1 {
  return shellStatusKinds(entry).length > 0 ? 1 : 0
}

/**
 * Longest argument *value* the approval card shows, in characters.
 *
 * Wider than {@link ARGS_MAX} because the two are answering different
 * questions. The transcript's summary identifies a call among many, so sixty
 * columns of the subject is plenty. The card asks the user to authorise this
 * exact call, and the part that gets cut is the part they were being asked
 * about — a `bash` command's tail, the flags after the subcommand.
 */
const APPROVAL_VALUE_MAX = 160

/** Argument rows the approval card draws before it starts counting the rest. */
const APPROVAL_MAX_ROWS = 6

/** One argument of a call awaiting approval, ready to draw. */
export interface ApprovalArg {
  /** The argument's key, or `''` when the payload had no keys to show. */
  key: string
  /** The value, collapsed to one line and truncated. */
  value: string
}

/** What the approval card draws below the tool's name. */
export interface ApprovalArgs {
  /** The rows to draw, at most {@link APPROVAL_MAX_ROWS}. */
  rows: readonly ApprovalArg[]
  /** How many arguments were left out. */
  hidden: number
}

/**
 * Break a tool call's arguments into the rows an approval card shows.
 *
 * The transcript shows one identifying argument (`Bash(pnpm test)`), which is
 * the right amount for a line the user is skimming and the wrong amount for a
 * line the user is authorising: whichever argument the summary dropped is
 * exactly the one that could make the call something other than what it looks
 * like. So every top-level key is listed, and only the *values* are shortened.
 *
 * Malformed JSON degrades the way {@link toolCallSummary} does — the raw
 * payload as a single keyless row — because a model that fumbled the schema is
 * still describing a call the user has to decide about, and showing nothing
 * would be the one answer that helps least.
 * @param args - the call's arguments as a JSON string; may be empty or invalid.
 * @param maxRows - how many rows to draw before counting the rest.
 * @returns the rows and the number of arguments they leave out.
 */
export function approvalArgs(args: string, maxRows: number = APPROVAL_MAX_ROWS): ApprovalArgs {
  const trimmed = args.trim()
  if (trimmed === '') return { rows: [], hidden: 0 }
  const raw = (value: string): ApprovalArgs => ({
    rows: [{ key: '', value: truncate(oneLine(value), APPROVAL_VALUE_MAX) }],
    hidden: 0,
  })
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return raw(trimmed)
  }
  if (typeof parsed !== 'object' || parsed === null) return raw(String(parsed))
  const entries = Object.entries(parsed as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
  const limit = Math.max(1, maxRows)
  const shown = entries.slice(0, limit).map(([key, value]) => ({
    key,
    // A nested object or an array is re-serialised rather than shown as
    // `[object Object]`: the shape is part of what is being authorised.
    value: truncate(
      oneLine(typeof value === 'string' ? value : JSON.stringify(value)),
      APPROVAL_VALUE_MAX,
    ),
  }))
  return { rows: shown, hidden: Math.max(0, entries.length - shown.length) }
}

/**
 * Byte count as a short human string: `284 KB`, `1.4 MB`, `912 B`.
 *
 * Decimal units, not binary. The number sits on an attachment chip beside a
 * pixel size, where it answers "is this the big screenshot or the small one" —
 * and every file manager the user could check it against says `KB` for 1000.
 * A `KiB` here would be more precise and would disagree with Finder.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} B`
  if (bytes < 1_000_000) return `${String(Math.round(bytes / 1_000))} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * One attachment chip's text: name, intrinsic pixel size, encoded size.
 *
 * All three are what the ref itself carries, and each answers a different
 * "did I attach the right thing" — the name is what the user typed, the pixel
 * size distinguishes two screenshots with similar names, and the byte size is
 * the one that explains a refusal when the next one is too big.
 *
 * `name` is optional on the ref (the store strips path information and a
 * caller may supply nothing), so a nameless attachment still gets a chip
 * rather than one reading `undefined`.
 */
export function attachmentChip(ref: {
  name?: string
  width: number
  height: number
  bytes: number
}, fallbackName: string): string {
  const name = ref.name ?? fallbackName
  return `${name} · ${String(ref.width)}×${String(ref.height)} · ${formatBytes(ref.bytes)}`
}
