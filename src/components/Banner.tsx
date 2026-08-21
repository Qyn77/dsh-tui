/**
 * The startup banner — the generous brand splash shown on an empty
 * session, before the first message. Two columns:
 *
 *   left  · a pixel-art whale + the DeepSeek slogan
 *   right · a block-letter DEEPSEEK / HARNESS wordmark, then the
 *           active model, the working directory, and a tip line
 *
 * **The whale is a bitmap, not a string of block characters.** A
 * terminal cell is roughly twice as tall as it is wide, so art drawn
 * one-cell-per-pixel comes out vertically stretched and unreadable.
 * Instead {@link WHALE_BITMAP} is a 28×16 pixel grid and
 * {@link encodeBitmap} packs each *pair* of pixel rows into one text
 * row using the half-block characters `▀▄█` — so the pixels end up
 * square and the sprite reads as a whale.
 *
 * Every meta line below the wordmark is a single pre-composed,
 * width-budgeted string rendered as one `<Text>`. That is deliberate:
 * a row of several `<Text>` children lets Ink wrap mid-word, which is
 * what turned `/help` into `/hel` and `/status` into `/stat` in an
 * earlier revision.
 *
 * The banner is rendered *instead of* the compact {@link StatusBar}
 * while the session log is empty and collapses into it the moment the
 * first message lands — so the splash never permanently costs the user
 * screen rows. On terminals too narrow for the block wordmark it
 * degrades to a compact form that keeps every fact and drops only the
 * decoration.
 * @module @deepseek-ai/dsh-tui/components/Banner
 */

import React, { type FC } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { VERSION, readRepoLabel } from '../environment.ts'

/** DeepSeek's brand blue. Used for the whale's body and the DEEPSEEK wordmark. */
const BRAND_BLUE = '#4D6BFE'

/** A lighter tint of the brand blue, for HARNESS and the whale's belly. */
const BRAND_BLUE_LIGHT = '#9BADFF'

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
const WHALE_ROWS = encodeBitmap(WHALE_BITMAP)

/** DeepSeek's slogan, shown centered under the whale. */
const SLOGAN = '探索未至之境！'

/**
 * Display width of `text` in terminal columns. CJK characters occupy
 * two columns, which matters here because the slogan is Chinese and
 * `String.length` would report half its true width — centering on
 * `.length` puts it visibly off to the right.
 *
 * The ranges covered are the ones the UI actually uses: CJK ideographs,
 * the Chinese/Japanese punctuation block (which is where `！` lives),
 * Hiragana/Katakana, and Hangul. A full `wcwidth` implementation is
 * not worth the dependency for one slogan.
 * @param text - the string to measure.
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals … Yi
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
      (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd) // CJK extension planes
    width += isWide ? 2 : 1
  }
  return width
}

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
  return rows.map((row) => row.trimEnd())
}

/** Pre-rendered so the block type is computed once, not per keystroke. */
const DEEPSEEK_ROWS = renderBlockWord('DEEPSEEK')
const HARNESS_ROWS = renderBlockWord('HARNESS')

const WHALE_WIDTH = Math.max(...WHALE_ROWS.map((r) => r.text.length))
/**
 * Width of the right-hand column. Every meta line is budgeted against
 * this so the block type sets the column and the text never widens the
 * banner or wraps inside it.
 */
const META_WIDTH = Math.max(...renderBlockWord('DEEPSEEK').map((r) => r.length))
const COLUMN_GAP = 3
/** Frame border (2) plus `paddingX={2}` on both sides (4). */
const FRAME_PADDING = 6

/**
 * Total columns the two-column banner needs. Below this the banner
 * switches to its compact form rather than letting the art clip.
 */
export const BANNER_MIN_WIDTH = WHALE_WIDTH + COLUMN_GAP + META_WIDTH + FRAME_PADDING

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
 */
export function fitTail(line: string, width: number): string {
  if (width <= 0) return ''
  if (line.length <= width) return line
  if (width === 1) return '…'
  return `…${line.slice(-(width - 1))}`
}

/** How many characters of the session id to show. */
const SESSION_ID_CHARS = 12

/**
 * The tip line. Kept short enough to fit {@link META_WIDTH} at 80
 * columns, and only advertises commands that exist today — a tip
 * pointing at an unimplemented command is worse than no tip.
 */
const TIP = 'Tip: /help · /status · Tab completes'

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
 */
export function metaText(
  selection: ModelSelection,
  sessionId: SessionId,
  repo: string | undefined,
  cwd: string,
): MetaText {
  return {
    model: `${selection.provider}/${selection.model}`,
    session: `${String(sessionId).slice(0, SESSION_ID_CHARS)} · v${VERSION}`,
    // The branch rides on the path: both answer "where am I working?"
    // and deserve one row, not two.
    location: repo === undefined ? cwd : `${cwd} (${repo})`,
    tip: TIP,
  }
}

export const Banner: FC<BannerProps> = ({ selection, sessionId }) => {
  const { stdout } = useStdout()
  // Ink does not surface the column count when stdout is piped; 80 is
  // the safe assumption and is wide enough for the full banner.
  const columns = stdout?.columns ?? 80
  const meta = metaText(
    selection,
    sessionId,
    readRepoLabel(),
    displayCwd(process.cwd(), process.env['HOME']),
  )

  // Compact form: drop the whale and the block type, keep every fact.
  // With no two columns to balance, all four lines stack.
  if (columns < BANNER_MIN_WIDTH) {
    const w = Math.max(8, columns - FRAME_PADDING)
    return (
      <Box borderStyle="round" borderColor={BRAND_BLUE} flexDirection="column" paddingX={2} paddingY={1}>
        <Text color={BRAND_BLUE} bold>DEEPSEEK HARNESS</Text>
        <Text color="white" bold>{fitTail(meta.model, w)}</Text>
        <Text color="gray">{fitTail(meta.session, w)}</Text>
        <Text color="gray">{fitTail(meta.location, w)}</Text>
        <Text color={BRAND_BLUE_LIGHT}>{fitTail(meta.tip, w)}</Text>
      </Box>
    )
  }

  return (
    <Box
      borderStyle="round"
      borderColor={BRAND_BLUE}
      flexDirection="row"
      paddingX={2}
      paddingY={1}
      columnGap={COLUMN_GAP}
    >
      <Box flexDirection="column">
        {/*
          A blank row above and below the sprite so the whale reads as
          a framed illustration rather than something wedged against
          the wordmark's cap height.
        */}
        <Text> </Text>
        {WHALE_ROWS.map((row, i) => (
          <Text key={`whale-${i}`} color={row.belly ? BRAND_BLUE_LIGHT : BRAND_BLUE}>
            {row.text}
          </Text>
        ))}
        <Text> </Text>
        {/*
          Centered on the sprite's own width, not the column's, so the
          slogan sits under the whale's midline. The measurement has to
          be in display columns — the slogan is Chinese, and centering
          on `.length` would place it half a whale to the right.
        */}
        <Text color={BRAND_BLUE} bold>{centerText(SLOGAN, WHALE_WIDTH)}</Text>
        {/*
          The "where am I?" half of the meta, moved here to use the rows
          the slogan left empty and to stop the right column carrying
          four stacked lines on its own. Both are fitted to the sprite's
          width, not the terminal's: the column takes its width from its
          widest child, so an unfitted long path would widen this column
          and shove the wordmark off the right edge.
        */}
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{fitTail(meta.session, WHALE_WIDTH)}</Text>
          <Text color="gray">{fitTail(meta.location, WHALE_WIDTH)}</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        {/* Matches the whale column's leading blank so the wordmark's
            cap height lines up with the sprite's top row. */}
        <Text> </Text>
        {DEEPSEEK_ROWS.map((row, i) => (
          <Text key={`ds-${i}`} color={BRAND_BLUE}>{row}</Text>
        ))}
        {HARNESS_ROWS.map((row, i) => (
          <Text key={`hn-${i}`} color={BRAND_BLUE_LIGHT}>{row}</Text>
        ))}
        {/* The "what and how" half: which model answers, and how to
            drive it. */}
        <Box marginTop={1} flexDirection="column">
          <Text color="white" bold>{fitTail(meta.model, META_WIDTH)}</Text>
          <Text color={BRAND_BLUE_LIGHT}>{fitTail(meta.tip, META_WIDTH)}</Text>
        </Box>
      </Box>
    </Box>
  )
}

/** Props for {@link Banner}. */
export interface BannerProps {
  /** Currently selected model for the agent. */
  selection: ModelSelection
  /** Session id of the live agent. */
  sessionId: SessionId
}
