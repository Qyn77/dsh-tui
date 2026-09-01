/**
 * The banner's art and text, with no React in it.
 *
 * This is the half of the startup banner that is data and arithmetic: the
 * whale bitmap and its half-block encoder, the block font and its renderer,
 * the width thresholds that decide how much of the banner survives, and the
 * meta-line composition. `components/Banner.tsx` holds the other half — the
 * three tiers of layout — and imports from here.
 *
 * **The whale is a bitmap, not a string of block characters.** A terminal cell
 * is roughly twice as tall as it is wide, so art drawn one-cell-per-pixel comes
 * out vertically stretched and unreadable. Instead {@link WHALE_BITMAP} is a
 * 28×16 pixel grid and {@link encodeBitmap} packs each *pair* of pixel rows
 * into one text row using the half-block characters `▀▄█` — so the pixels end
 * up square and the sprite reads as a whale.
 *
 * The split follows the package's existing seam (SPEC §3.1): a pure module
 * beside the component that renders it, the way `prompt-editing.ts` sits beside
 * `Prompt.tsx`. Everything here is callable from a unit test without mounting
 * anything, which is how `tests/banner.spec.ts` reads it.
 * @module @deepseek-ai/dsh-tui/banner-art
 */

import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { VERSION } from './environment.ts'
import { displayWidth } from './width.ts'
import { catalog } from './i18n.ts'

/** DeepSeek's brand blue. Used for the whale's body and the DEEPSEEK wordmark. */
export const BRAND_BLUE = '#4D6BFE'

/** A lighter tint of the brand blue, for HARNESS and the whale's belly. */
export const BRAND_BLUE_LIGHT = '#9BADFF'

/**
 * The whale as a pixel grid. `#` is body, `B` is belly (drawn in the
 * lighter tint), `.` is transparent. Height must be even so every
 * pixel row pairs off; width is padded to a uniform 28 so the
 * right-hand column starts at a fixed offset.
 *
 * The eyes are the two 2×2 holes on rows 6–7. They sit on the *same*
 * pixel-row pair on purpose: split across two pairs they encode as
 * `▀▀` above `▄▄` and read as teeth rather than eyes.
 */
const WHALE_BITMAP: readonly string[] = [
  '....................##....##',
  '....................##....##',
  '.....................##..##.',
  '.....######...........####..',
  '...##########........####...',
  '..#############....#####....',
  '.####..####..###########....',
  '.####..####..###########....',
  '.#######################....',
  '.#######################....',
  '.#######################....',
  '..#####################.....',
  '..BBBBBBBBBBBBBBBBBBBBB.....',
  '..BBBBBBBBBBBBBBBBBBBBB.....',
  '....BBBBBBBBBBBBBBBBB.......',
  '.....BBBBBBBBBBBBBBB........',
]

/** One text row of an encoded bitmap. */
export interface BitmapRow {
  /** The row's half-block characters. */
  text: string
  /** True when either pixel row was belly (`B`), so it draws lighter. */
  belly: boolean
}

/**
 * Pack a pixel bitmap into text rows using half-block characters.
 * Each output row encodes two input rows: `█` both set, `▀` top only,
 * `▄` bottom only, space neither. This is what makes the pixels
 * square on a terminal cell that is twice as tall as it is wide.
 * @param bitmap - rows of `#` (set), `B` (set + belly), `.` (clear).
 * @returns one {@link BitmapRow} per pair of input rows.
 */
export function encodeBitmap(bitmap: readonly string[]): BitmapRow[] {
  const rows: BitmapRow[] = []
  for (let y = 0; y < bitmap.length; y += 2) {
    const top = bitmap[y] ?? ''
    const bottom = bitmap[y + 1] ?? ''
    const width = Math.max(top.length, bottom.length)
    let text = ''
    let belly = false
    for (let x = 0; x < width; x += 1) {
      const t = top[x] ?? '.'
      const b = bottom[x] ?? '.'
      const tSet = t !== '.'
      const bSet = b !== '.'
      if (t === 'B' || b === 'B') belly = true
      text += tSet && bSet ? '█' : tSet ? '▀' : bSet ? '▄' : ' '
    }
    rows.push({ text, belly })
  }
  return rows
}

/** Pre-encoded so the sprite is packed once, not on every render. */
export const WHALE_ROWS = encodeBitmap(WHALE_BITMAP)

/** DeepSeek's slogan, shown centered under the whale. */
export const SLOGAN = '探索未至之境！'

/**
 * The whale reduced to a single row, for the tier too narrow to draw
 * the sprite. Same glyph the StatusBar uses, so the brand mark stays
 * recognisable across every width.
 */
export const SMALL_WHALE = '▄█▀▀█▄'

/**
 * Left-pad `text` so it sits centered in a field of `width` columns.
 * Padding is measured in display columns (see {@link displayWidth}),
 * and a string wider than the field is returned unpadded rather than
 * pushed negative.
 * @param text - the string to center.
 * @param width - the field width, in columns.
 */
export function centerText(text: string, width: number): string {
  const pad = Math.floor((width - displayWidth(text)) / 2)
  return pad > 0 ? `${' '.repeat(pad)}${text}` : text
}

/**
 * A 4×5 block font, just wide enough for the two words in the
 * wordmark. Adding a letter means adding one 5-row entry here; the
 * renderer does not need to change.
 */
const BLOCK_FONT: Record<string, readonly string[]> = {
  A: [' ██ ', '█  █', '████', '█  █', '█  █'],
  D: ['███ ', '█  █', '█  █', '█  █', '███ '],
  E: ['████', '█   ', '███ ', '█   ', '████'],
  H: ['█  █', '█  █', '████', '█  █', '█  █'],
  K: ['█  █', '█ █ ', '██  ', '█ █ ', '█  █'],
  N: ['█  █', '██ █', '█ ██', '█  █', '█  █'],
  P: ['███ ', '█  █', '███ ', '█   ', '█   '],
  R: ['███ ', '█  █', '███ ', '█ █ ', '█  █'],
  S: ['████', '█   ', '████', '   █', '████'],
}

/** Rows in one line of block type. */
const BLOCK_ROWS = 5

/**
 * Render `word` as {@link BLOCK_ROWS} strings of block type. Letters
 * are separated by a single blank column. Characters missing from
 * {@link BLOCK_FONT} render as blank cells rather than throwing, so a
 * future rename cannot crash the banner.
 * @param word - the word to render, in any case.
 * @returns exactly {@link BLOCK_ROWS} strings.
 */
export function renderBlockWord(word: string): string[] {
  const rows = Array.from({ length: BLOCK_ROWS }, () => '')
  for (const char of word.toUpperCase()) {
    const glyph = BLOCK_FONT[char] ?? ['    ', '    ', '    ', '    ', '    ']
    for (let r = 0; r < BLOCK_ROWS; r += 1) {
      rows[r] += `${glyph[r]} `
    }
  }
  return rows.map(row => row.trimEnd())
}

/** Pre-rendered so the block type is computed once, not per keystroke. */
export const DEEPSEEK_ROWS = renderBlockWord('DEEPSEEK')
export const HARNESS_ROWS = renderBlockWord('HARNESS')

/** Width of the whale sprite, in columns. */
export const WHALE_WIDTH = Math.max(...WHALE_ROWS.map(r => r.text.length))

/**
 * Width of the block-letter wordmark, and therefore of the right-hand
 * column. Both columns pin an explicit width so the art lands at its
 * designed size; they stay *shrinkable* on purpose, because a column
 * that refuses to shrink overflows the frame instead, and overflow is
 * the one failure Ink cannot recover from (see the note on `Banner`).
 */
export const WORDMARK_WIDTH = Math.max(...DEEPSEEK_ROWS.map(r => r.length))

/** Columns between the two columns of the full tier. */
export const COLUMN_GAP = 3

/** Frame border (2) plus `paddingX={2}` on both sides (4). */
export const FRAME_PADDING = 6

/**
 * Total columns the two-column banner needs. Below this the banner
 * switches to a narrower tier rather than letting the art clip.
 */
export const BANNER_MIN_WIDTH = WHALE_WIDTH + COLUMN_GAP + WORDMARK_WIDTH + FRAME_PADDING

/** Columns the wordmark-only tier needs. */
export const BANNER_WORDMARK_WIDTH = WORDMARK_WIDTH + FRAME_PADDING

/** How much of the banner survives at the current terminal width. */
export type BannerTier = 'full' | 'wordmark' | 'plain'

/**
 * Pick the widest tier that fits. Three tiers rather than two because
 * the drop from the full spread to a single text line is a 45-column
 * cliff: between those bounds the wordmark still fits perfectly well on
 * its own, and it is the half that carries the product's name.
 */
export function bannerTier(columns: number): BannerTier {
  if (columns >= BANNER_MIN_WIDTH) return 'full'
  if (columns >= BANNER_WORDMARK_WIDTH) return 'wordmark'
  return 'plain'
}

/**
 * Shorten `cwd` for display by replacing the home-directory prefix
 * with `~`.
 */
export function displayCwd(cwd: string, home: string | undefined): string {
  if (home !== undefined && home !== '' && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}`
  }
  return cwd
}

/**
 * Trim `line` to `width` columns, keeping the tail and marking the cut
 * with a leading `…`. Paths and ids carry their identity in the tail,
 * which is why this truncates from the front — the opposite of the
 * message-list `truncate`.
 *
 * Measured in display columns rather than characters, because the tip line is
 * translated and a CJK glyph is two columns wide. Counting characters would let
 * a Chinese line up to twice its budget through, and every `<Text>` in the
 * banner is `wrap="truncate"` precisely so that no row can exceed the box —
 * a line that overflows anyway is the one failure this component's own comments
 * call worse than a bad frame, because Ink erases by logical line count and a
 * terminal-wrapped row is under-erased on every resize.
 *
 * The tail is still sliced by character. That can leave the result one column
 * narrower than the budget when the cut lands where a wide glyph would have
 * started; under-filling by a column is invisible, while overflowing by one is
 * the bug above.
 */
export function fitTail(line: string, width: number): string {
  if (width <= 0) return ''
  if (displayWidth(line) <= width) return line
  if (width === 1) return '…'
  const budget = width - 1
  // Code points, deliberately. This walks backwards accumulating display width,
  // so it needs units `displayWidth` can measure one at a time — which UTF-16
  // code units are not: splitting a surrogate pair yields two halves that are
  // neither the original glyph nor measurable. A grapheme cluster would be
  // better still for combining marks, but the lines here are paths, session ids
  // and the one-line tip, none of which carry them.
  // oxlint-disable-next-line typescript/no-misused-spread
  const chars = [...line]
  let taken = 0
  let start = chars.length
  while (start > 0) {
    const next = displayWidth(chars[start - 1] ?? '')
    if (taken + next > budget) break
    taken += next
    start -= 1
  }
  return `…${chars.slice(start).join('')}`
}

/** How many characters of the session id to show. */
const SESSION_ID_CHARS = 12

/** The four meta facts, unfitted. Each column budgets its own width. */
export interface MetaText {
  /** `provider/model`. */
  model: string
  /** `<session id> · v<version>`. */
  session: string
  /** `<cwd>` plus ` (<branch>)` when inside a git repository. */
  location: string
  /** The static tip line. */
  tip: string
}

/**
 * Compose the banner's meta facts as raw strings. Kept separate from
 * rendering because the two columns budget different widths: the left
 * column is locked to the sprite's width and the right to the
 * wordmark's, so a single pre-fitted string could not serve both.
 * @param selection - the active model selection.
 * @param sessionId - the live session's id.
 * @param repo - the git label, or `undefined` outside a repository.
 * @param cwd - the working directory, already home-shortened.
 * @param tip - the localized tip line. Defaults to English so a caller that
 * only wants the three factual rows — the tests do — need not reach for a
 * catalog to get them.
 */
export function metaText(
  selection: ModelSelection,
  sessionId: SessionId,
  repo: string | undefined,
  cwd: string,
  tip: string = catalog('en').banner.tip,
): MetaText {
  return {
    model: `${selection.provider}/${selection.model}`,
    session: `${String(sessionId).slice(0, SESSION_ID_CHARS)} · v${VERSION}`,
    // The branch rides on the path: both answer "where am I working?"
    // and deserve one row, not two.
    location: repo === undefined ? cwd : `${cwd} (${repo})`,
    tip,
  }
}
