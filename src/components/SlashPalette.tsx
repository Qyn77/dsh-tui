/**
 * The in-progress `/` command palette. Floats above the Prompt when
 * the buffer is a prefix matching one or more registered commands
 * (see `filterCommands` in `commands.ts`). The currently highlighted
 * row is what Enter / Tab will complete to. Visual rules:
 *   - `round` border, `cyan` to match the active prompt.
 *   - The selected row gets an inverted color block (`cyan` background,
 *     `black` foreground) so it stands out at a glance — this is how
 *     Claude Code and most TUIs signal "current selection".
 *   - The name column is padded to a fixed width so the descriptions
 *     line up.
 * The palette does not own any state itself; the parent passes
 * `commands` and `selected` so the same index can drive the highlight
 * and any completion actions.
 * @module @deepseek-ai/dsh-tui/components/SlashPalette
 */

import React, { type FC } from 'react'
import { Box, Text } from 'ink'
import type { CommandMeta } from '../commands.ts'
import { useStrings } from '../hooks/useStrings.tsx'

/** Props for {@link SlashPalette}. */
export interface SlashPaletteProps {
  /** Filtered list of commands to show. May be empty. */
  commands: readonly CommandMeta[]
  /** Index into `commands` of the highlighted row. */
  selected: number
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

export const SlashPalette: FC<SlashPaletteProps> = ({ commands, selected }) => {
  const strings = useStrings()
  if (commands.length === 0) return null
  const colWidth = nameColumnWidth(commands)
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      flexDirection="column"
      paddingX={1}
    >
      {commands.map((cmd, i) => {
        const isSelected = i === selected
        // Pad the name with trailing spaces so the descriptions line
        // up at a fixed column. The trailing `·` is the visual
        // separator Claude Code uses.
        const paddedName = cmd.name.padEnd(colWidth)
        if (isSelected) {
          return (
            <Box key={cmd.name}>
              <Text backgroundColor="cyan" color="black" bold>
                {' '}
                {paddedName}
                {' · '}
                {cmd.description}
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
            <Text color="gray">
              {' · '}
              {cmd.description}
            </Text>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {strings.palette.hint}
        </Text>
      </Box>
    </Box>
  )
}
