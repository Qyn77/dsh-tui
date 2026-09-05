/**
 * The floating palette above the Prompt: the `/` command list, and — with
 * `description` omitted and its own `hint` — the `@` file picker. One
 * component for both, because two bordered lists with the same selection
 * idiom would drift apart on the first visual change made to either.
 *
 * It opens when the buffer is a prefix matching one or more registered
 * commands (see `filterCommands` in `commands.ts`), or when the caret is in a
 * mention (`mentionAt` in `file-mentions.ts`). The currently highlighted row
 * is what Enter / Tab will complete to. Visual rules:
 *   - `round` border, `cyan` to match the active prompt.
 *   - The selected row gets an inverted color block (`cyan` background,
 *     `black` foreground) so it stands out at a glance — this is how
 *     Claude Code and most TUIs signal "current selection".
 *   - The name column is padded to a fixed width so the descriptions
 *     line up.
 *   - The list is windowed to `maxRows` and scrolls to keep the selection
 *     visible, with a count of what is off-screen next to the hint. This is
 *     load-bearing rather than cosmetic: see `paletteWindowRows` in
 *     `prompt-layout.ts`.
 * The palette does not own any state itself; the parent passes
 * `commands` and `selected` so the same index can drive the highlight
 * and any completion actions.
 * @module @deepseek-ai/dsh-tui/components/SlashPalette
 */

import React, { type FC } from 'react'
import { Box, Text } from 'ink'
import type { CommandMeta } from '../commands.ts'
import { MAX_PALETTE_ROWS, visibleStart } from '../prompt-layout.ts'
import { useStrings } from '../hooks/useStrings.tsx'

/** Props for {@link SlashPalette}. */
export interface SlashPaletteProps {
  /** Filtered list of commands to show. May be empty. */
  commands: readonly CommandMeta[]
  /** Index into `commands` of the highlighted row. */
  selected: number
  /** Key legend for the last row. Defaults to the `/` palette's. */
  hint?: string
  /**
   * Rows of list to show at once. Defaults to {@link MAX_PALETTE_ROWS}; the
   * Prompt passes `paletteWindowRows` of the live terminal height.
   */
  maxRows?: number
}

/** Padded width of the name column. Two spaces of gutter, then name, then gutter. */
const NAME_GUTTER = 2

/**
 * Compute the name column width across the filtered slice. Two spaces
 * of gutter so the descriptions do not crowd the names.
 */
function nameColumnWidth(commands: readonly CommandMeta[]): number {
  let max = 0
  for (const c of commands) {
    if (c.name.length > max) max = c.name.length
  }
  return max + NAME_GUTTER
}

export const SlashPalette: FC<SlashPaletteProps> = ({ commands, selected, hint, maxRows }) => {
  const strings = useStrings()
  if (commands.length === 0) return null
  // The window is derived, never stored: `selected` is the only thing that
  // moves it, so a sticky `previous` would be memory with nothing to
  // remember. Passing 0 makes the list sit at the top until the selection
  // walks past the bottom edge, then follow it a row at a time.
  const window = Math.max(1, Math.floor(maxRows ?? MAX_PALETTE_ROWS))
  const start = visibleStart(commands.length, selected, window, 0)
  const shown = commands.slice(start, start + window)
  const hidden = commands.length - shown.length
  // Width comes from the visible slice, so scrolling cannot leave the
  // descriptions indented for a name that is no longer on screen.
  const colWidth = nameColumnWidth(shown)
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
    >
      {shown.map((cmd, i) => {
        const isSelected = start + i === selected
        // Pad the name with trailing spaces so the descriptions line
        // up at a fixed column. The trailing `·` is the visual
        // separator Claude Code uses.
        // A row with no description is not padded either: the column exists
        // to line descriptions up, and a file picker has none to line up.
        const described = cmd.description !== ''
        const paddedName = described ? cmd.name.padEnd(colWidth) : cmd.name
        if (isSelected) {
          return (
            <Box key={cmd.name}>
              <Text backgroundColor="cyan" color="black" bold>
                {' '}
                {paddedName}
                {described ? ` · ${cmd.description}` : ''}
                {' '}
              </Text>
            </Box>
          )
        }
        return (
          <Box key={cmd.name}>
            <Text color="cyan" bold>
              {cmd.name}
            </Text>
            {described && (
              <Text color="gray">
                {' · '}
                {cmd.description}
              </Text>
            )}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {hint ?? strings.palette.hint}
          {hidden > 0 ? strings.palette.more(hidden) : ''}
        </Text>
      </Box>
    </Box>
  )
}
