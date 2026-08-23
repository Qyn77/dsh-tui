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
/** Longest single-line result summary shown under a call. */
const RESULT_MAX = 200

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
 * Reduce a tool result to one line.
 *
 * A `ToolResultMessage` carries exactly one `tool-result` block, and the text
 * the user wants is inside *that* block's content — not in the message's own
 * content array. Reading only the outer level finds nothing, ever, which is
 * how tool results came to render as an empty row.
 * @param message - the result message the tool returned.
 * @returns a single-line summary, or `''` when there is no text to show.
 */
export function toolResultSummary(message: ToolResultMessage): string {
  const lines = resultText(message.content).split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) return ''
  const first = truncate(oneLine(lines[0]), RESULT_MAX)
  // A multi-line result shows its first line plus how much was withheld, so a
  // long payload is visibly abridged rather than looking like the whole thing.
  return lines.length > 1 ? `${first} (+${lines.length - 1} more)` : first
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

/** Status marker for a tool call. */
export function toolStatusGlyph(status: 'running' | 'ok' | 'error'): string {
  switch (status) {
    case 'ok':
      return '✓'
    case 'error':
      return '✗'
    case 'running':
      return '…'
  }
}
