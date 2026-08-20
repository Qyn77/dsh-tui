/**
 * The bottom input box. Single-line for v1 with a `\` continuation
 * marker; future PR can add a real multi-line editor.
 *
 * When the buffer starts with `/` and contains no space yet, a
 * {@link SlashPalette} floats above the box showing the matching
 * slash commands. ↑/↓ navigate the palette, Tab completes the
 * highlighted name, Enter runs an exact match (otherwise completes),
 * Esc clears the buffer.
 * @module @deepseek-ai/dsh-tui/components/Prompt
 */

import React, { useState, type FC } from 'react'
import { Box, Text, useInput } from 'ink'
import { SPINNER_FRAMES } from '../hooks/useRunningClock.ts'
import { filterCommands, type CommandMeta } from '../commands.ts'
import { SlashPalette } from './SlashPalette.tsx'

/** Props for {@link Prompt}. */
export interface PromptProps {
  /** Whether input is accepted (false while a turn is running). */
  active: boolean
  /** Called with the full line when the user submits a non-slash message. */
  onSubmit: (text: string) => void
  /** Index into {@link SPINNER_FRAMES} for the running-mode placeholder. */
  spinnerFrame: number
}

/**
 * The single-line prompt with a `\` continuation marker. Backspace works
 * naturally; Enter submits unless the buffer ends in `\`, in which case it
 * becomes a newline character.
 */
export function insertTextAtCursor(text: string, cursor: number, input: string): string {
  const safeCursor = Math.min(Math.max(0, cursor), text.length)
  return `${text.slice(0, safeCursor)}${input}${text.slice(safeCursor)}`
}

export function removeCharBeforeCursor(text: string, cursor: number): string {
  if (cursor <= 0 || cursor > text.length) return text
  return `${text.slice(0, cursor - 1)}${text.slice(cursor)}`
}

/**
 * The buffer is in "palette mode" when it starts with `/` and has no
 * space yet. A space means "the user is typing arguments" and the
 * palette should disappear so the prompt returns to plain-text mode.
 * @param value - the current buffer.
 */
function isPaletteMode(value: string): boolean {
  return value.startsWith('/') && !value.includes(' ')
}

/**
 * Clamp the palette selection back into range when the filtered list
 * shrinks (e.g. the user keeps typing and the prefix no longer
 * matches anything).
 */
function clampPaletteIndex(index: number, commands: readonly CommandMeta[]): number {
  if (commands.length === 0) return 0
  if (index < 0) return 0
  if (index >= commands.length) return commands.length - 1
  return index
}

export const Prompt: FC<PromptProps> = ({ active, onSubmit, spinnerFrame }) => {
  const [value, setValue] = useState('')
  const [cursorIndex, setCursorIndex] = useState(0)
  const [paletteIndex, setPaletteIndex] = useState(0)

  // Filter is a pure derivation from `value`; no effect needed. The
  // selection index is clamped on every keystroke so an out-of-range
  // cursor from rapid input never escapes.
  const palette = isPaletteMode(value) ? filterCommands(value) : []
  const safePaletteIndex = clampPaletteIndex(paletteIndex, palette)

  // Ink's raw mode hides the terminal cursor, so we render our own.
  // Keep it stable instead of blinking: the prompt is already visually
  // distinct while active, and a 500ms re-render loop is unnecessary churn
  // on a terminal UI that has to stay smooth while scrolling the log.
  useInput(
    (input, key) => {
      // Ctrl-modified keystrokes are reserved for the App-level
      // handlers (Ctrl-C exits the REPL; future Ctrl-K / Ctrl-L / etc.
      // will too). If we let them fall through, Ctrl-C would append
      // 'c' to the buffer.
      if (key.ctrl) return
      // Esc — when the palette is open, dismiss it by clearing the
      // buffer. When the palette is closed, leave the buffer alone
      // (Esc has no other meaning in a single-line prompt).
      if (key.escape) {
        if (palette.length > 0) {
          setValue('')
          setCursorIndex(0)
          setPaletteIndex(0)
        }
        return
      }
      // Tab — complete the highlighted command. The cursor lands
      // after a trailing space so the user can keep typing arguments
      // without an extra keystroke.
      if (key.tab && palette.length > 0) {
        const chosen = palette[safePaletteIndex]
        if (chosen) {
          const completed = `${chosen.name} `
          setValue(completed)
          setCursorIndex(completed.length)
          setPaletteIndex(0)
        }
        return
      }
      // ↑/↓ — when the palette is open, navigate. When closed, these
      // keys are unused (history is a v0.2 feature) so we just bail.
      if (key.upArrow) {
        if (palette.length > 0) {
          setPaletteIndex((i) => clampPaletteIndex(i - 1, palette))
        }
        return
      }
      if (key.downArrow) {
        if (palette.length > 0) {
          setPaletteIndex((i) => clampPaletteIndex(i + 1, palette))
        }
        return
      }
      if (key.return) {
        if (value.endsWith('\\')) {
          const next = `${value.slice(0, -1)}\n`
          setValue(next)
          setCursorIndex(next.length)
          return
        }
        // Palette open with an exact match — run it. We compare
        // against the registry's `name` so case is normalized.
        if (palette.length > 0) {
          const normalized = value.toLowerCase()
          const exact = palette.find((c) => c.name === normalized)
          if (exact) {
            setValue('')
            setCursorIndex(0)
            setPaletteIndex(0)
            onSubmit(exact.name)
            return
          }
          // Otherwise, complete the highlighted name into the buffer
          // so the user can keep editing without losing context.
          const chosen = palette[safePaletteIndex]
          if (chosen) {
            const completed = `${chosen.name} `
            setValue(completed)
            setCursorIndex(completed.length)
            setPaletteIndex(0)
          }
          return
        }
        const submitted = value
        setValue('')
        setCursorIndex(0)
        onSubmit(submitted)
        return
      }
      if (key.leftArrow) {
        setCursorIndex((i) => Math.max(0, i - 1))
        return
      }
      if (key.rightArrow) {
        setCursorIndex((i) => Math.min(value.length, i + 1))
        return
      }
      if (key.backspace || key.delete) {
        setValue((current) => {
          const nextCursor = Math.max(0, cursorIndex - 1)
          const nextValue = removeCharBeforeCursor(current, cursorIndex)
          setCursorIndex(nextCursor)
          return nextValue
        })
        return
      }
      if (input) {
        setValue((current) => {
          const nextValue = insertTextAtCursor(current, cursorIndex, input)
          setCursorIndex(cursorIndex + input.length)
          return nextValue
        })
      }
    },
    { isActive: active },
  )

  const visibleValue = value === '' ? '' : value
  // The running placeholder is the same spinner glyph the StatusBar
  // uses, so the two indicators stay in lock-step. Both come from
  // the App's single `useRunningClock` interval; idle placeholder
  // is unchanged.
  const placeholder = active ? 'Ask dsh anything…' : `${SPINNER_FRAMES[spinnerFrame]} working`
  const beforeCursor = value.slice(0, cursorIndex)
  const afterCursor = value.slice(cursorIndex)
  const cursor = active ? <Text color="cyan" bold>▌</Text> : null

  return (
    <Box flexDirection="column">
      {palette.length > 0 ? (
        <Box marginBottom={1}>
          <SlashPalette commands={palette} selected={safePaletteIndex} />
        </Box>
      ) : null}
      <Box
        borderStyle="round"
        borderColor={active ? 'cyan' : 'gray'}
        paddingX={1}
      >
        <Text color="cyan" bold>
          {'> '}
        </Text>
        {visibleValue === '' ? (
          <>
            {cursor}
            <Text color="gray" dimColor>
              {placeholder}
            </Text>
          </>
        ) : (
          <>
            <Text>{beforeCursor}</Text>
            {cursor}
            <Text>{afterCursor}</Text>
          </>
        )}
      </Box>
    </Box>
  )
}
