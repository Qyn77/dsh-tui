/**
 * Pure text operations on the prompt buffer: insertion, deletion, and word
 * motions. No React, no Ink, no state — every function takes a buffer and a
 * caret index and returns what they become, which is what makes the caret
 * behaviour testable without painting a frame.
 *
 * Two conventions hold throughout:
 *
 * - **A word is whitespace-delimited.** readline draws a distinction —
 *   `Ctrl-W` stops at whitespace, `Alt-B`/`Alt-F` stop at punctuation too —
 *   but this is a prompt where the things people delete are file paths, URLs
 *   and flags. Splitting `~/.dsh/.env` into six words would make `Alt-B` a
 *   key you press repeatedly rather than once, so all four motions use the
 *   same, wider definition.
 * - **Everything is buffer-scoped, not line-scoped.** The buffer can hold
 *   newlines, but its visible rows are *wrapped* rather than logical, so a
 *   line-scoped `Ctrl-K` would delete to a boundary the user cannot see. The
 *   two are identical for the single-row buffer that is the common case, and
 *   for the rest, consistency with `Ctrl-A`/`Ctrl-E` (also buffer ends) is
 *   worth more than matching readline exactly.
 *
 * A caret index arriving from outside is clamped rather than trusted: these
 * run on every keystroke, and an out-of-range index from rapid input should
 * cost the user nothing.
 * @module @deepseek-ai/dsh-tui/prompt-editing
 */

/** Clamp a caret index into `[0, text.length]`. */
function clamp(cursor: number, text: string): number {
  return Math.min(Math.max(0, cursor), text.length)
}

/** Whether the character at `index` is whitespace (out of range counts as not). */
function isSpaceAt(text: string, index: number): boolean {
  const char = text[index]
  return char !== undefined && /\s/.test(char)
}

/** Insert `input` at the caret. */
export function insertTextAtCursor(text: string, cursor: number, input: string): string {
  const safe = clamp(cursor, text)
  return `${text.slice(0, safe)}${input}${text.slice(safe)}`
}

/** Delete the single character before the caret. */
export function removeCharBeforeCursor(text: string, cursor: number): string {
  if (cursor <= 0 || cursor > text.length) return text
  return `${text.slice(0, cursor - 1)}${text.slice(cursor)}`
}

/**
 * The index at the start of the word before the caret: skip any whitespace
 * the caret is sitting behind, then the word itself. Already at the start of
 * the buffer, it stays there.
 */
export function wordStartBefore(text: string, cursor: number): number {
  let index = clamp(cursor, text)
  while (index > 0 && isSpaceAt(text, index - 1)) index -= 1
  while (index > 0 && !isSpaceAt(text, index - 1)) index -= 1
  return index
}

/**
 * The index at the end of the word after the caret — the mirror of
 * {@link wordStartBefore}: skip whitespace, then the word.
 */
export function wordEndAfter(text: string, cursor: number): number {
  let index = clamp(cursor, text)
  while (index < text.length && isSpaceAt(text, index)) index += 1
  while (index < text.length && !isSpaceAt(text, index)) index += 1
  return index
}

/**
 * Delete from the start of the word before the caret up to the caret, and
 * report where the caret lands. The trailing whitespace goes with the word,
 * so `Ctrl-W` on `ls -la ` leaves `ls ` rather than `ls -la`.
 */
export function deleteWordBefore(text: string, cursor: number): { text: string; cursor: number } {
  const safe = clamp(cursor, text)
  const start = wordStartBefore(text, safe)
  if (start === safe) return { text, cursor: safe }
  return { text: `${text.slice(0, start)}${text.slice(safe)}`, cursor: start }
}

/** Delete from the caret to the end of the buffer. */
export function deleteToEnd(text: string, cursor: number): string {
  return text.slice(0, clamp(cursor, text))
}

/**
 * Delete from the start of the buffer up to the caret — the mirror of
 * {@link deleteToEnd}, and what `Ctrl-U` means in readline. Buffer-scoped
 * like everything else here: with the caret on a wrapped second row this
 * clears the rows above it too, which is the same bargain `Ctrl-A` makes.
 */
export function deleteToStart(text: string, cursor: number): string {
  return text.slice(clamp(cursor, text))
}

/**
 * Append a submitted line to the prompt history, newest last. An empty line
 * and a repeat of the newest entry are both dropped: holding Enter, or
 * sending `/status` twice to watch something change, should not pad the
 * history with entries the user then has to walk back through.
 */
export function pushHistory(history: readonly string[], entry: string): string[] {
  if (entry === '') return [...history]
  if (history[history.length - 1] === entry) return [...history]
  return [...history, entry]
}
