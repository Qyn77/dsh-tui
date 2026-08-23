/**
 * Pure scroll math for the conversation viewport, plus the input decoding
 * Ink cannot do for us. No React, no Ink, no I/O — this module is the test
 * surface for everything the MessageList's scrolling depends on.
 *
 * The one idea worth holding onto: **the offset is measured in rows, never
 * in entries.** The old viewport paged by entry count while the terminal
 * clips by row, so the two units never agreed and the newest messages fell
 * off the bottom of a clipped box where no key could reach them. Rows are
 * what the terminal has, so rows are what we count.
 * @module @deepseek-ai/dsh-tui/scroll
 */

import type { UiEntry } from './types.ts'
import { userMessageText } from './types.ts'
import { GUTTER_WIDTH, toolCallSummary, toolResultSummary } from './message-layout.ts'

/**
 * Escape, built rather than quoted. Every control character in this
 * module is constructed this way on purpose: a literal `ESC` byte in a
 * source file is invisible in editors, diffs, and review, and an
 * invisible byte on one side of a comparison is exactly how the old
 * `input === '<ESC>[H'` check came to look correct while never matching
 * anything a terminal sends.
 */
const ESC = String.fromCharCode(27)

/** Rows one wheel notch scrolls. Three is the common terminal default. */
export const MOUSE_WHEEL_ROWS = 3

/**
 * Rows a full page scrolls. Two rows of overlap keep the reader's place:
 * the last lines of the previous screen lead into the next one.
 */
export function pageDelta(viewportRows: number): number {
  return Math.max(1, viewportRows - 2)
}

/** Rows a half-page (`Ctrl-U` / `Ctrl-D`) scrolls. */
export function halfPageDelta(viewportRows: number): number {
  return Math.max(1, Math.floor(viewportRows / 2))
}

/**
 * Clamp a scroll offset into the range the content actually supports.
 * `0` means pinned to the newest row; the maximum is however many rows
 * stick out above the viewport.
 *
 * `contentRows` is the *measured* height of the mounted window, so this
 * bound is exact at the top of the log (where the window holds every
 * entry) and merely generous while there is still history above it — the
 * window is always mounted with at least a viewport of slack, so a loose
 * bound can never stop a scroll that should have been allowed.
 */
export function clampOffset(offset: number, contentRows: number, viewportRows: number): number {
  const max = Math.max(0, contentRows - viewportRows)
  if (!Number.isFinite(offset) || offset < 0) return 0
  return Math.min(Math.floor(offset), max)
}

/**
 * Does this `useInput` payload look like a mouse report rather than typed
 * text? Ink hands mouse reports to every `useInput` handler as ordinary
 * input with the leading `ESC` stripped (`[<64;12;30M`), so the Prompt
 * has to recognise and drop them — otherwise a spin of the wheel types
 * its own coordinates into the buffer.
 *
 * Both encodings are accepted: SGR (`[<b;x;yM`) and the legacy X10 form
 * (`[M` plus three bytes). Note that `index.ts` no longer *asks* for mouse
 * reporting — that costs the terminal's own click-to-select — but a
 * terminal configured to report anyway must scroll rather than type.
 */
export function isMouseReport(input: string): boolean {
  return /^\[(?:<[0-9;]*[Mm]|M)/.test(input)
}

/**
 * Net rows to scroll for the wheel notches in one `useInput` payload.
 * Positive scrolls up into history, negative scrolls back toward the
 * newest row. A payload can carry several reports when the wheel is spun
 * faster than the event loop drains stdin, so every report in the string
 * counts.
 *
 * Only the wheel buttons contribute. Clicks and drags (buttons 0-2) are
 * reported through the same channel and are deliberately ignored: the
 * TUI has nothing clickable, and swallowing them keeps a stray click
 * from moving the view.
 */
export function parseWheelDelta(input: string): number {
  let delta = 0
  for (const match of input.matchAll(/\[<([0-9]+);[0-9]+;[0-9]+[Mm]/g)) {
    const button = Number(match[1])
    // Bit 6 marks a wheel event; the low bit picks the direction. The
    // remaining bits carry Shift/Meta/Ctrl, which we treat the same.
    if ((button & 0b100_0000) === 0) continue
    delta += (button & 1) === 1 ? -MOUSE_WHEEL_ROWS : MOUSE_WHEEL_ROWS
  }
  return delta
}

/**
 * The `Home`/`End` sequences a terminal may send, in raw (ESC-prefixed)
 * form: the `CSI` variants, the `SS3` forms an application-cursor-keys
 * terminal uses, and the numbered `~` forms.
 */
const NAV_KEYS: Readonly<Record<string, 'home' | 'end'>> = {
  [`${ESC}[H`]: 'home',
  [`${ESC}OH`]: 'home',
  [`${ESC}[1~`]: 'home',
  [`${ESC}[7~`]: 'home',
  [`${ESC}[F`]: 'end',
  [`${ESC}OF`]: 'end',
  [`${ESC}[4~`]: 'end',
  [`${ESC}[8~`]: 'end',
}

/**
 * Decode `Home` / `End` from a raw stdin chunk.
 *
 * These keys cannot be read through `useInput` at all: Ink blanks `input`
 * for every name in its `nonAlphanumericKeys` table and exposes flags for
 * only a fixed set of keys — `home` and `end` are in the first list but
 * not the second, so the keystroke arrives as `('', {})`, indistinguishable
 * from noise. The information survives only in the raw bytes, which is why
 * {@link useMessageListScroll} keeps a stdin listener alongside its
 * `useInput` handler. The chunk is matched whole: a lone keystroke is its
 * own read, and anything batched with other bytes is left alone.
 */
export function parseNavKey(chunk: string): 'home' | 'end' | undefined {
  return NAV_KEYS[chunk]
}

/** Rows a block of text occupies when wrapped into `width` columns. */
function textRows(text: string, width: number): number {
  const columns = Math.max(1, width)
  let rows = 0
  for (const line of text.split('\n')) {
    rows += Math.max(1, Math.ceil(line.length / columns))
  }
  return rows
}

/**
 * Approximate the rendered height of one entry.
 *
 * This estimate decides **how many entries to mount**, and nothing else.
 * The visible offset is applied to the mounted window's real, laid-out
 * bottom edge, so an estimate that is off by a few rows moves nothing on
 * screen — it only changes how much history stands ready above the fold.
 * That is why a plain character count is good enough: it is exact for
 * ASCII and *under*-counts wide (CJK) glyphs, and under-counting is the
 * safe direction — it mounts more entries than needed, never fewer.
 *
 * The arithmetic tracks `MessageList`'s layout, so it has to move whenever
 * that layout does. Every entry is a gutter row: one blank row of separation,
 * then the rows its own text wraps to, indented by the gutter width. No
 * border, no bottom margin. Over-counting here is the failure that bites — it
 * stops the mount short of the history the offset is asking for, and the
 * oldest entries become unreachable.
 */
export function estimateEntryRows(entry: UiEntry, columns: number): number {
  const width = Math.max(1, columns - GUTTER_WIDTH)
  // Every entry carries `marginTop={1}` to separate it from the one above.
  return 1 + entryBodyRows(entry, width)
}

/** Rows one entry's own content occupies, excluding its separating margin. */
function entryBodyRows(entry: UiEntry, width: number): number {
  switch (entry.kind) {
    case 'user':
      return textRows(userMessageText(entry.message) || ' ', width)
    case 'assistant':
      // Finalized turns re-render as markdown, which adds a blank row
      // between blocks; the raw text is the floor, which is the safe side.
      return 1 + textRows(entry.text || ' ', width)
    case 'tool': {
      // The call line, plus one line of outcome when there is one. Both
      // summaries are collapsed to a single line before they are drawn, so
      // they only cost more than a row by wrapping.
      let rows = textRows(toolCallSummary(entry.name, entry.args), width)
      if (entry.error !== undefined) rows += 1
      else if (entry.result) rows += textRows(toolResultSummary(entry.result), width)
      return rows
    }
    case 'runtime-context':
      return 1 + (entry.preview === '' ? 0 : textRows(entry.preview, width))
    case 'note':
    case 'compaction':
    case 'plan':
      return 1
    default: {
      const _exhaustive: never = entry
      return 1 + Number(Boolean(_exhaustive))
    }
  }
}

/** Fewest entries to keep mounted, so a short log never windows at all. */
const MIN_MOUNTED_ENTRIES = 20

/**
 * Index of the first entry to mount for a given scroll offset.
 *
 * The window always reaches the newest entry, and that is what makes the
 * offset arithmetic exact: the mounted content's bottom edge *is* the
 * log's bottom edge. Above the fold we mount the rows the offset asks for
 * plus a viewport of slack, so scrolling up finds content already laid
 * out instead of a blank gap.
 */
export function windowStart(
  entries: readonly UiEntry[],
  columns: number,
  offset: number,
  viewportRows: number,
): number {
  const needed = Math.max(0, offset) + Math.max(1, viewportRows) * 2 + 10
  let rows = 0
  let index = entries.length
  while (index > 0) {
    if (rows >= needed && entries.length - index >= MIN_MOUNTED_ENTRIES) break
    index -= 1
    rows += estimateEntryRows(entries[index], columns)
  }
  return index
}
