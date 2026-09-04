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
 * Render a tool call as `name(subject)`.
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
  const subject = toolCallSubject(args)
  return subject === '' ? name : `${name}(${subject})`
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
