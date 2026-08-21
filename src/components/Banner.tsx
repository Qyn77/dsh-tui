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
  '..BBBBBBBBBBBBBBBBBBBBB.....',
  '...BBBBBBBBBBBBBBBBBBB......',
  '....BBBBBBBBBBBBBBBBB.......',
  '.....BBBBBBBBBBBBBBB........',
  '.......BBBBBBBBBBB..........',
  '..........BBBBB.............',
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

/** DeepSeek's slogan, shown under the whale. */
const SLOGAN = '探索未至之境！'

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

const MetaLines: FC<{ selection: ModelSelection; sessionId: SessionId; width: number }> = ({
  selection,
  sessionId,
  width,
}) => {
  const shortSession = String(sessionId).slice(0, SESSION_ID_CHARS)
  // Each line is one pre-composed string in one <Text>. Several
  // <Text> children on a row would let Ink wrap mid-word.
  const modelLine = fitTail(`${selection.model} · ${shortSession}`, width)
  const cwdLine = fitTail(displayCwd(process.cwd(), process.env['HOME']), width)
  const tipLine = fitTail(TIP, width)
  return (
    <>
      <Text color="white" bold>{modelLine}</Text>
      <Text color="gray">{cwdLine}</Text>
      <Text color={BRAND_BLUE_LIGHT}>{tipLine}</Text>
    </>
  )
}

export const Banner: FC<BannerProps> = ({ selection, sessionId }) => {
  const { stdout } = useStdout()
  // Ink does not surface the column count when stdout is piped; 80 is
  // the safe assumption and is wide enough for the full banner.
  const columns = stdout?.columns ?? 80

  // Compact form: drop the whale and the block type, keep every fact.
  if (columns < BANNER_MIN_WIDTH) {
    const compactWidth = Math.max(8, columns - FRAME_PADDING)
    return (
      <Box borderStyle="round" borderColor={BRAND_BLUE} flexDirection="column" paddingX={2} paddingY={1}>
        <Text color={BRAND_BLUE} bold>DEEPSEEK HARNESS</Text>
        <MetaLines selection={selection} sessionId={sessionId} width={compactWidth} />
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
        {WHALE_ROWS.map((row, i) => (
          <Text key={`whale-${i}`} color={row.belly ? BRAND_BLUE_LIGHT : BRAND_BLUE}>
            {row.text}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text color={BRAND_BLUE} bold>{SLOGAN}</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        {DEEPSEEK_ROWS.map((row, i) => (
          <Text key={`ds-${i}`} color={BRAND_BLUE}>{row}</Text>
        ))}
        {HARNESS_ROWS.map((row, i) => (
          <Text key={`hn-${i}`} color={BRAND_BLUE_LIGHT}>{row}</Text>
        ))}
        <Box marginTop={1} flexDirection="column">
          <MetaLines selection={selection} sessionId={sessionId} width={META_WIDTH} />
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
