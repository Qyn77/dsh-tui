/**
 * How the prompt buffer becomes rows on screen: folding, caret position,
 * the visible window, and the scrollbar.
 *
 * Pure — no React, no Ink, no IO. That is what makes the caret arithmetic
 * testable, and the caret is the whole reason this module exists: the
 * renderer draws the rows this module produces, so the caret's row and
 * column are *derived from the same fold* rather than guessed alongside it.
 * A word-wrapping fold would break that, which is why the fold here is by
 * character.
 * @module @deepseek-ai/dsh-tui/prompt-layout
 */

import { displayWidth } from './width.ts'

/**
 * Rows of text the prompt may grow to before it starts scrolling instead.
 * Ten rows plus the border is twelve, which still leaves a usable
 * conversation on a 24-row terminal.
 */
export const MAX_PROMPT_ROWS = 10

/**
 * Rows of *list* the floating palette may show at once.
 *
 * Eight, to match `MAX_MENTION_ROWS` — the `@` picker and the `/` palette are
 * the same component and a reader comparing them should not have to explain a
 * difference. The built-in command table alone is fifteen rows, so without a
 * cap the palette is taller than a short terminal on its own.
 */
export const MAX_PALETTE_ROWS = 8

/**
 * Rows the palette's list gets on a terminal of `terminalRows` rows.
 *
 * Load-bearing, not cosmetic. The App gives its root box a fixed
 * `rows - 3` height so Ink stays on log-update's incremental path; a subtree
 * that overflows that height does not scroll, it *overlaps* — Yoga lays the
 * extra rows on top of the ones already there and the frame comes out with
 * two commands printed on one line, or with fragments of the palette stranded
 * above the StatusBar until the next resize repaints everything. The palette
 * is the one subtree whose height is driven by data rather than by the
 * viewport, so it is the one that has to yield.
 *
 * The reserve covers everything the palette shares the frame with: the
 * StatusBar (3), the prompt box (3), the palette's own border, blank row and
 * hint (4), and the App's three-row gap to the bottom of the screen.
 * @param terminalRows - `stdout.rows`.
 * @returns at least one row, never more than {@link MAX_PALETTE_ROWS}.
 */
export function paletteWindowRows(terminalRows: number): number {
  const RESERVED = 13
  const available = Math.floor(terminalRows) - RESERVED
  return Math.max(1, Math.min(MAX_PALETTE_ROWS, available))
}

/**
 * Rows a floating list costs on top of its visible entries: the box border
 * (2), the blank row between the entries and the hint, the hint itself, and
 * the margin separating the whole thing from the prompt box.
 *
 * The counterpart to {@link paletteWindowRows}: that one asks how much list
 * fits, this one turns a list back into a height so the App can take the room
 * out of the banner's budget. Both have to move together if the palette's
 * chrome ever changes.
 */
export const PALETTE_CHROME_ROWS = 5

/** Scrollbar glyphs. The track is drawn dim; the thumb is not. */
const THUMB = '█'
const TRACK = '│'
/** What the reserved scrollbar column holds when there is nothing to scroll. */
const BLANK = ' '

/** One display row of the prompt buffer. */
export interface PromptRow {
  /** The row's text, without the newline that may have ended it. */
  text: string
  /** Index into the buffer of this row's first character. */
  start: number
}

/** Where the caret sits, in rows and characters (not columns). */
export interface CaretPosition {
  /** Index into the row array. */
  row: number
  /** Characters into that row's text — the split point for rendering. */
  offset: number
}

/**
 * Fold `value` into display rows against a column budget.
 *
 * Two rules that look arbitrary and are not:
 *
 * - **The fold is by character, never by word.** The renderer draws these
 *   rows verbatim and splits one of them at the caret, so any fold the
 *   caret arithmetic cannot reproduce exactly would misplace the caret.
 * - **A wide glyph that would straddle the right edge starts the next row**
 *   rather than being split, leaving the last column unused. A terminal
 *   cannot draw half of a CJK cell.
 *
 * A trailing newline produces a trailing empty row, because the caret has
 * to have somewhere to sit after it.
 * @param value - the whole buffer.
 * @param width - columns available for text.
 * @returns one row per display line; never empty.
 */
export function wrapBuffer(value: string, width: number): readonly PromptRow[] {
  const columns = Math.max(1, Math.floor(width) || 0)
  const rows: PromptRow[] = []
  let rowStart = 0
  let rowText = ''
  let rowWidth = 0
  let index = 0

  const flush = (nextStart: number): void => {
    rows.push({ text: rowText, start: rowStart })
    rowStart = nextStart
    rowText = ''
    rowWidth = 0
  }

  for (const char of value) {
    const size = char.length // code units, so surrogate pairs advance correctly
    if (char === '\n') {
      index += size
      flush(index)
      continue
    }
    const charWidth = displayWidth(char)
    // A glyph wider than the whole budget still has to go somewhere: it gets
    // a row of its own rather than looping forever.
    if (rowWidth + charWidth > columns && rowText !== '') {
      flush(index)
    }
    rowText += char
    rowWidth += charWidth
    index += size
  }
  rows.push({ text: rowText, start: rowStart })
  return rows
}

/**
 * Locate the caret within already-folded rows.
 *
 * A caret exactly on a soft-wrap boundary belongs to the **head of the next
 * row**, which is what every terminal editor does and the only choice that
 * keeps freshly typed text visible at the fold.
 * @param rows - output of {@link wrapBuffer}.
 * @param cursor - index into the buffer; clamped if out of range.
 */
export function cursorAt(rows: readonly PromptRow[], cursor: number): CaretPosition {
  const last = rows.length - 1
  const lastRow = rows[last]
  if (lastRow === undefined) return { row: 0, offset: 0 }
  const limit = lastRow.start + lastRow.text.length
  const safe = Math.min(Math.max(0, Math.floor(cursor) || 0), limit)
  // Walk from the end: the last row that starts at or before the caret owns
  // it, which resolves the boundary case in favour of the next row.
  for (let row = last; row >= 0; row -= 1) {
    const candidate = rows[row]
    if (candidate !== undefined && candidate.start <= safe) {
      return { row, offset: Math.min(safe - candidate.start, candidate.text.length) }
    }
  }
  return { row: 0, offset: 0 }
}

/**
 * Display columns between the start of `row` and `offset` characters into it.
 *
 * Columns, not characters, because that is what the user sees: the caret is
 * drawn by splitting the row's text at `offset`, so two rows agree on where
 * the caret "is" only if they agree in columns. A row of CJK is half as many
 * characters as a row of ASCII at the same width.
 */
export function columnAt(row: PromptRow, offset: number): number {
  return displayWidth(row.text.slice(0, Math.max(0, offset)))
}

/**
 * The offset in `row` that sits at `column`, or the last one before it.
 *
 * Landing *before* the target rather than after is what keeps a walk down
 * through a row of wide glyphs from drifting rightwards: a caret that rounded
 * up would gain a column on every row whose glyphs do not divide evenly.
 * @returns a character offset into `row.text`, clamped to its end.
 */
export function offsetAtColumn(row: PromptRow, column: number): number {
  const target = Math.max(0, column)
  let width = 0
  let offset = 0
  for (const char of row.text) {
    const next = width + displayWidth(char)
    if (next > target) break
    width = next
    offset += char.length
  }
  return offset
}

/** Where a vertical caret move landed, and the column it is still aiming for. */
export interface VerticalMove {
  /** New index into the buffer. */
  cursor: number
  /** The row it landed on. */
  row: number
  /** The column to keep aiming for on the next move in the same direction. */
  column: number
}

/**
 * Move the caret one row and report the column it is still aiming for.
 *
 * The `desired` column is the whole point. Without it, walking down through a
 * short row clamps the caret to that row's end and the next move down starts
 * from there — three rows later the caret has slid to the left margin and the
 * user's original column is gone. Every terminal editor remembers it; this one
 * did not, and the drift is most obvious in exactly the buffer people write in
 * the prompt, where one short line sits between two long ones.
 *
 * Passing `desired` through unchanged (rather than recomputing it from the
 * landed caret) is what makes the walk reversible: down through a short row and
 * back up returns to the column it started in.
 *
 * @param rows - output of {@link wrapBuffer}.
 * @param cursor - current index into the buffer.
 * @param delta - rows to move; `-1` up, `+1` down.
 * @param desired - a column carried over from a previous vertical move, or
 * `undefined` to start a fresh walk from where the caret is now.
 * @returns the move, or `undefined` when there is no such row — the caller
 * leaves the caret alone rather than clamping it to the buffer's end, because a
 * wall is easier to feel than a jump.
 */
export function moveVertically(
  rows: readonly PromptRow[],
  cursor: number,
  delta: number,
  desired?: number,
): VerticalMove | undefined {
  const caret = cursorAt(rows, cursor)
  const current = rows[caret.row]
  if (current === undefined) return undefined
  const targetRow = caret.row + delta
  const target = rows[targetRow]
  if (target === undefined) return undefined
  const column = desired ?? columnAt(current, caret.offset)
  const offset = offsetAtColumn(target, column)
  return { cursor: target.start + offset, row: targetRow, column }
}

/**
 * The first visible row, given where the caret is and where the window was.
 *
 * The window is sticky: it only moves when the caret would leave it. That is
 * what makes typing at the bottom scroll one row at a time instead of
 * re-centring, and what leaves the view alone while the caret moves inside
 * it.
 * @param total - number of folded rows.
 * @param cursorRow - the caret's row.
 * @param maxRows - visible rows.
 * @param previous - the previous first visible row.
 */
export function visibleStart(
  total: number,
  cursorRow: number,
  maxRows: number,
  previous: number,
): number {
  const window = Math.max(1, Math.floor(maxRows))
  const highest = Math.max(0, total - window)
  let start = Math.min(Math.max(0, Math.floor(previous) || 0), highest)
  if (cursorRow < start) start = cursorRow
  if (cursorRow > start + window - 1) start = cursorRow - window + 1
  return Math.min(Math.max(0, start), highest)
}

/**
 * One glyph per visible row: the scrollbar as a column of characters.
 *
 * The column is returned even when nothing overflows — as blanks. That is
 * deliberate: a bar that appeared only on overflow would change the text
 * width at the moment it appeared, re-folding every row under the caret.
 * The same reasoning reserved the message list's "scrolled into history"
 * row; see `docs/lessons/message-list-scroll.md`.
 * @param total - number of folded rows.
 * @param maxRows - visible rows.
 * @param start - first visible row.
 */
export function scrollbarColumn(total: number, maxRows: number, start: number): readonly string[] {
  const window = Math.max(1, Math.floor(maxRows))
  const visible = Math.min(window, Math.max(1, total))
  if (total <= window) return Array.from({ length: visible }, () => BLANK)

  // At least one row of thumb, and at least one row of track: a bar that
  // filled itself would say "nothing to scroll" while there is.
  const size = Math.min(window - 1, Math.max(1, Math.round((window * window) / total)))
  const span = window - size
  const scrollable = total - window
  const offset = Math.min(span, Math.max(0, Math.round((start / scrollable) * span)))
  return Array.from({ length: window }, (_unused, row) =>
    row >= offset && row < offset + size ? THUMB : TRACK,
  )
}
