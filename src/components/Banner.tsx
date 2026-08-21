/**
 * The startup banner — the generous brand splash shown on an empty
 * session, before the first message. Two columns:
 *
 *   left  · a block-art whale + the DeepSeek slogan
 *   right · a block-letter DEEPSEEK / HARNESS wordmark, then the
 *           active model, the working directory, and a tip line
 *
 * A terminal cannot reproduce true pixel art, so the whale and the
 * wordmark are drawn with the half/full block characters (U+2580,
 * U+2584, U+2588, U+258C, U+2590) that every monospace font we
 * support ships. The result reads as the same shape at terminal
 * resolution.
 *
 * The banner is deliberately tall (13 rows). It is rendered *instead
 * of* the compact {@link StatusBar} while the session log is empty and
 * collapses into it the moment the first message lands — so the splash
 * never permanently costs the user screen rows. On terminals too
 * narrow for the block wordmark it degrades to a compact form.
 * @module @deepseek-ai/dsh-tui/components/Banner
 */

import React, { type FC } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Props for {@link Banner}. */
export interface BannerProps {
  /** Currently selected model for the agent. */
  selection: ModelSelection
  /** Session id of the live agent. */
  sessionId: SessionId
}

/** DeepSeek's brand blue. Used for the whale and the DEEPSEEK wordmark. */
const BRAND_BLUE = '#4D6BFE'

/** A lighter tint of the brand blue, for the HARNESS half of the wordmark. */
const BRAND_BLUE_LIGHT = '#9BADFF'

/**
 * The whale, drawn with block characters. Rows are padded to a
 * uniform width so the right-hand column starts at a fixed offset
 * regardless of which row is widest. The final row is rendered in a
 * lighter color as the belly.
 */
const WHALE: readonly string[] = [
  '                 ▄█▀',
  '    ▄▄▄▄▄▄▄▄   ▄█▀  ',
  '  ▄█▀▀     ▀▀▄█▀    ',
  ' ▐█  █   █     ▀█▄  ',
  ' ▐█              █▌ ',
  '  ▀█▄▄        ▄▄█▀  ',
  '    ▀▀███████▀▀     ',
]

/** Index into {@link WHALE} of the row drawn as the (lighter) belly. */
const WHALE_BELLY_ROW = WHALE.length - 1

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
 * @returns exactly {@link BLOCK_ROWS} strings of equal length.
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

/**
 * Total columns the two-column banner needs: the whale, a gap, and
 * the wider of the two wordmark lines, plus the frame's own padding.
 * Below this the banner switches to its compact form.
 */
const WHALE_WIDTH = Math.max(...WHALE.map((r) => r.length))
const WORDMARK_WIDTH = Math.max(DEEPSEEK_ROWS[0]?.length ?? 0, HARNESS_ROWS[0]?.length ?? 0)
const COLUMN_GAP = 3
const FRAME_PADDING = 6
export const BANNER_MIN_WIDTH = WHALE_WIDTH + COLUMN_GAP + WORDMARK_WIDTH + FRAME_PADDING

/**
 * Shorten `cwd` for display by replacing the home-directory prefix
 * with `~`. Long paths are left intact — the banner row has the full
 * terminal width and Ink will wrap rather than corrupt the layout.
 */
export function displayCwd(cwd: string, home: string | undefined): string {
  if (home !== undefined && home !== '' && cwd.startsWith(home)) {
    return `~${cwd.slice(home.length)}`
  }
  return cwd
}

/** The tip line. Only advertises commands that actually exist today. */
const TIP_PARTS: readonly (readonly [string, string])[] = [
  ['/help', 'list commands'],
  ['/status', 'show model + session'],
  ['Tab', 'complete a slash command'],
]

const MetaLines: FC<{ selection: ModelSelection; sessionId: SessionId }> = ({ selection, sessionId }) => (
  <>
    <Box>
      <Text color="white" bold>{selection.model}</Text>
      <Text color="gray"> · </Text>
      <Text color="gray">{String(sessionId)}</Text>
    </Box>
    <Box>
      <Text color="gray">{displayCwd(process.cwd(), process.env['HOME'])}</Text>
    </Box>
    <Box>
      <Text color="gray">Tip: </Text>
      {TIP_PARTS.map(([key, label], i) => (
        <React.Fragment key={key}>
          {i > 0 ? <Text color="gray"> · </Text> : null}
          <Text color={BRAND_BLUE} bold>{key}</Text>
          <Text color="gray">{` ${label}`}</Text>
        </React.Fragment>
      ))}
    </Box>
  </>
)

export const Banner: FC<BannerProps> = ({ selection, sessionId }) => {
  const { stdout } = useStdout()
  // Ink does not surface the column count when stdout is piped; 80 is
  // the safe assumption and is wide enough for the full banner.
  const columns = stdout?.columns ?? 80

  // Compact form: no block wordmark and no whale, just the brand line
  // and the meta rows. Keeps every piece of information, drops only
  // the decoration — the opposite trade-off from clipping the art.
  if (columns < BANNER_MIN_WIDTH) {
    return (
      <Box borderStyle="round" borderColor={BRAND_BLUE} flexDirection="column" paddingX={2} paddingY={1}>
        <Box>
          <Text color={BRAND_BLUE} bold>DEEPSEEK</Text>
          <Text color={BRAND_BLUE_LIGHT} bold> HARNESS</Text>
        </Box>
        <MetaLines selection={selection} sessionId={sessionId} />
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
        {WHALE.map((row, i) => (
          <Text
            key={`whale-${i}`}
            color={i === WHALE_BELLY_ROW ? BRAND_BLUE_LIGHT : BRAND_BLUE}
            bold
          >
            {row}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text color={BRAND_BLUE} bold>{SLOGAN}</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        {DEEPSEEK_ROWS.map((row, i) => (
          <Text key={`ds-${i}`} color={BRAND_BLUE} bold>{row}</Text>
        ))}
        {HARNESS_ROWS.map((row, i) => (
          <Text key={`hn-${i}`} color={BRAND_BLUE_LIGHT} bold>{row}</Text>
        ))}
        <Box marginTop={1} flexDirection="column">
          <MetaLines selection={selection} sessionId={sessionId} />
        </Box>
      </Box>
    </Box>
  )
}
