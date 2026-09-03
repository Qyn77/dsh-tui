/**
 * The startup banner — the generous brand splash shown on an empty
 * session, before the first message. Two columns:
 *
 *   left  · a pixel-art whale + the DeepSeek slogan
 *   right · a block-letter DEEPSEEK / HARNESS wordmark, then the
 *           active model, the working directory, and a tip line
 *
 * The art, the block font, the width thresholds and the meta-line
 * composition all live in `banner-art.ts`, which has no React in it and
 * is unit-tested directly. This module is the layout: three tiers of it.
 *
 * Every meta line below the wordmark is a single pre-composed,
 * width-budgeted string rendered as one `<Text>`. That is deliberate:
 * a row of several `<Text>` children lets Ink wrap mid-word, which is
 * what turned `/help` into `/hel` and `/status` into `/stat` in an
 * earlier revision.
 *
 * The banner is **static output**: `renderer.tsx` renders it inside
 * Ink's `<Static>`, so it is written to the terminal exactly once and
 * then scrolls away like any other past output. The compact
 * {@link StatusBar} takes over as the live header once there is a
 * message to head. Rendering it once is what keeps it intact — Ink
 * erases the previous dynamic frame by counting *logical* lines, so a
 * line the terminal has wrapped is under-erased, and every stdout
 * `resize` redraws the whole dynamic frame. Nineteen rows of art inside
 * that frame left a shredded copy of themselves behind on each resize.
 *
 * On terminals too narrow for the block wordmark it degrades to a
 * compact form that keeps every fact and drops only the decoration.
 * @module @deepseek-ai/dsh-tui/components/Banner
 */

import React, { type FC } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  BRAND_BLUE,
  BRAND_BLUE_LIGHT,
  COLUMN_GAP,
  DEEPSEEK_ROWS,
  FRAME_PADDING,
  HARNESS_ROWS,
  type MetaText,
  SLOGAN,
  SMALL_WHALE,
  WHALE_ROWS,
  WHALE_WIDTH,
  WORDMARK_WIDTH,
  bannerTier,
  centerText,
  displayCwd,
  fitTail,
  metaText,
} from '../banner-art.ts'
import { readRepoLabel } from '../environment.ts'
import { useStrings } from '../hooks/useStrings.tsx'

/**
 * The four meta facts stacked in one column, for the tiers that have
 * only one column to stack them in.
 */
const MetaStack: FC<{ meta: MetaText; width: number }> = ({ meta, width }) => (
  <Box flexDirection="column" width={width}>
    {/* `bold` with no color, not `white`: see the note on the wordmark's copy
        of this line. */}
    <Text bold wrap="truncate">{fitTail(meta.model, width)}</Text>
    <Text color="gray" wrap="truncate">{fitTail(meta.session, width)}</Text>
    <Text color="gray" wrap="truncate">{fitTail(meta.location, width)}</Text>
    <Text color={BRAND_BLUE_LIGHT} wrap="truncate">{fitTail(meta.tip, width)}</Text>
  </Box>
)

export const Banner: FC<BannerProps> = ({ selection, sessionId }) => {
  const { stdout } = useStdout()
  const strings = useStrings()
  // Read once, at the single paint this component gets: `useStdout` does
  // not re-render on resize, and as static output the banner would not
  // be redrawn even if it did. The width it was printed at is the width
  // it keeps, which is exactly how the rest of the terminal's scrollback
  // behaves. Ink does not surface the column count when stdout is piped;
  // 80 is the safe assumption and is wide enough for the full banner.
  const columns = stdout?.columns ?? 80
  const tier = bannerTier(columns)
  const meta = metaText(
    selection,
    sessionId,
    readRepoLabel(),
    displayCwd(process.cwd(), process.env['HOME']),
    strings.banner.tip,
  )

  // Narrowest tier: no art at all, every fact kept. One line of brand
  // so the splash still reads as ours, then the meta stack.
  if (tier === 'plain') {
    const w = Math.max(8, columns - FRAME_PADDING)
    return (
      <Box borderStyle="round" borderColor={BRAND_BLUE} flexDirection="column" paddingX={2} paddingY={1}>
        <Text color={BRAND_BLUE} bold wrap="truncate">
          {fitTail(`${SMALL_WHALE} DEEPSEEK HARNESS`, w)}
        </Text>
        <MetaStack meta={meta} width={w} />
      </Box>
    )
  }

  // Middle tier: the whale is what does not fit, so the whale is what
  // goes. The wordmark carries the name and still lands intact.
  if (tier === 'wordmark') {
    return (
      <Box borderStyle="round" borderColor={BRAND_BLUE} flexDirection="column" paddingX={2} paddingY={1}>
        {DEEPSEEK_ROWS.map((row, i) => (
          <Text key={`ds-${i}`} color={BRAND_BLUE} wrap="truncate">{row}</Text>
        ))}
        {HARNESS_ROWS.map((row, i) => (
          <Text key={`hn-${i}`} color={BRAND_BLUE_LIGHT} wrap="truncate">{row}</Text>
        ))}
        <Text color={BRAND_BLUE} bold wrap="truncate">{centerText(SLOGAN, WORDMARK_WIDTH)}</Text>
        <Box marginTop={1}>
          <MetaStack meta={meta} width={WORDMARK_WIDTH} />
        </Box>
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
      {/*
        Both columns pin an explicit width so the art lands at its
        designed size, and both stay shrinkable. That combination is
        deliberate: `wrap="truncate"` on every `<Text>` is what keeps the
        row count fixed, so a squeezed column clips its tail instead of
        re-wrapping. Refusing to shrink would trade that clip for an
        overflow — lines wider than the terminal, which the terminal
        wraps and Ink's line-counting eraser then fails to erase, leaving
        shredded copies of the banner behind. A clipped whale is a bad
        frame; an overflowing one corrupts every frame after it.
      */}
      <Box flexDirection="column" width={WHALE_WIDTH}>
        {/*
          A blank row above and below the sprite so the whale reads as
          a framed illustration rather than something wedged against
          the wordmark's cap height.
        */}
        <Text> </Text>
        {WHALE_ROWS.map((row, i) => (
          <Text key={`whale-${i}`} color={row.belly ? BRAND_BLUE_LIGHT : BRAND_BLUE} wrap="truncate">
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
        <Text color={BRAND_BLUE} bold wrap="truncate">{centerText(SLOGAN, WHALE_WIDTH)}</Text>
        {/*
          The "where am I?" half of the meta, moved here to use the rows
          the slogan left empty and to stop the right column carrying
          four stacked lines on its own.
        */}
        <Box marginTop={1} flexDirection="column">
          <Text color="gray" wrap="truncate">{fitTail(meta.session, WHALE_WIDTH)}</Text>
          <Text color="gray" wrap="truncate">{fitTail(meta.location, WHALE_WIDTH)}</Text>
        </Box>
      </Box>
      <Box flexDirection="column" width={WORDMARK_WIDTH}>
        {/* Matches the whale column's leading blank so the wordmark's
            cap height lines up with the sprite's top row. */}
        <Text> </Text>
        {DEEPSEEK_ROWS.map((row, i) => (
          <Text key={`ds-${i}`} color={BRAND_BLUE} wrap="truncate">{row}</Text>
        ))}
        {HARNESS_ROWS.map((row, i) => (
          <Text key={`hn-${i}`} color={BRAND_BLUE_LIGHT} wrap="truncate">{row}</Text>
        ))}
        {/* The "what and how" half: which model answers, and how to
            drive it. */}
        <Box marginTop={1} flexDirection="column">
          {/* Bold and *uncolored*, rather than `white`. The model name is the
              one line in this banner that has to be the most legible thing on
              screen, and `white` is a palette entry — on a light-background
              terminal it resolves to something near the background and the
              line all but disappears. The default foreground is the only color
              guaranteed to contrast, because it is the one the terminal picked
              for exactly that job. This costs nothing on a dark background,
              where `white` was already what the default resolved to. */}
          <Text bold wrap="truncate">{fitTail(meta.model, WORDMARK_WIDTH)}</Text>
          <Text color={BRAND_BLUE_LIGHT} wrap="truncate">{fitTail(meta.tip, WORDMARK_WIDTH)}</Text>
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
