/**
 * The bottom input box. It grows with the buffer up to
 * {@link MAX_PROMPT_ROWS} rows and then scrolls internally, with a
 * scrollbar column on the right and the caret always in view. `Ctrl-J`
 * inserts a newline; so does a trailing `\` before `Enter`.
 *
 * Two things are worth knowing before editing the layout:
 *
 * - **The buffer is folded by this component, not by Ink.** `<Text>` would
 *   wrap it for free, but then nothing here would know how many rows the
 *   result occupies or which row the caret is on, and both are needed to cap
 *   the height and to scroll. `prompt-layout.ts` does the fold; every row is
 *   drawn verbatim as its own `<Text wrap="truncate">`.
 * - **The text width is measured, not calculated.** `measureElement` reports
 *   the real inner width, the same pattern the MessageList uses for its
 *   viewport. The arithmetic fallback (`columns - 8`) only covers the first
 *   frame, before a measurement exists.
 *
 * When the buffer starts with `/` and contains no space yet, a
 * {@link SlashPalette} floats above the box showing the matching
 * slash commands. ↑/↓ navigate the palette, Tab completes the
 * highlighted name, Enter runs an exact match (otherwise completes),
 * Esc clears the buffer.
 *
 * ↑/↓ are shared with the conversation viewport, and Ink dispatches a
 * keystroke to *every* `useInput` handler — there is no bubbling to stop. So
 * ownership is decided here and reported upward through
 * `onArrowClaimChange`: while the palette is open or the buffer occupies
 * more than one row, these keys belong to the prompt and the log's arrow
 * scrolling stands down. `PageUp`/`PageDown` and `Ctrl-B/F/U/D` always
 * belong to the log, so the keyboard never loses its way through history.
 * @module @deepseek-ai/dsh-tui/components/Prompt
 */

import React, { useEffect, useRef, useState, type FC } from 'react'
import { Box, Text, measureElement, useInput, useStdout, type DOMElement } from 'ink'
import { SPINNER_FRAMES } from '../hooks/useRunningClock.ts'
import { filterCommands, type CommandMeta } from '../commands.ts'
import { isMouseReport } from '../scroll.ts'
import {
  MAX_PROMPT_ROWS,
  cursorAt,
  scrollbarColumn,
  visibleStart,
  wrapBuffer,
} from '../prompt-layout.ts'
import { SlashPalette } from './SlashPalette.tsx'

/** Props for {@link Prompt}. */
export interface PromptProps {
  /** Whether input is accepted (false while a turn is running). */
  active: boolean
  /** Called with the full line when the user submits a non-slash message. */
  onSubmit: (text: string) => void
  /** Index into {@link SPINNER_FRAMES} for the running-mode placeholder. */
  spinnerFrame: number
  /**
   * Report whether ↑/↓ currently belong to the prompt. The App forwards the
   * answer to `useMessageListScroll` so the two do not both act on one
   * keystroke. Optional: a prompt rendered without it simply never claims
   * the keys.
   */
  onArrowClaimChange?: (claimed: boolean) => void
}

/**
 * Columns the box spends on everything that is not buffer text: the root's
 * reserved right column (1), the border (2), the horizontal padding (2), the
 * `> ` prefix column (2) and the scrollbar column (1). Only used until
 * `measureElement` has a real number.
 */
const CHROME_COLUMNS = 8

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

export const Prompt: FC<PromptProps> = ({
  active,
  onSubmit,
  spinnerFrame,
  onArrowClaimChange,
}) => {
  const { stdout } = useStdout()
  const [value, setValue] = useState('')
  const [cursorIndex, setCursorIndex] = useState(0)
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [textWidth, setTextWidth] = useState(0)
  const textRef = useRef<DOMElement | null>(null)

  // Filter is a pure derivation from `value`; no effect needed. The
  // selection index is clamped on every keystroke so an out-of-range
  // cursor from rapid input never escapes.
  const palette = isPaletteMode(value) ? filterCommands(value) : []
  const safePaletteIndex = clampPaletteIndex(paletteIndex, palette)

  // The fold, the caret and the window are all derived on every render —
  // never stored. `scrollTop` is the one piece of memory, and it is only
  // *read* here; the handlers below are what move it.
  const width = textWidth > 0 ? textWidth : Math.max(1, (stdout?.columns ?? 80) - CHROME_COLUMNS)
  const rows = wrapBuffer(value, width)
  const caret = cursorAt(rows, cursorIndex)
  const start = visibleStart(rows.length, caret.row, MAX_PROMPT_ROWS, scrollTop)
  const visibleRows = rows.slice(start, start + MAX_PROMPT_ROWS)
  const scrollbar = scrollbarColumn(rows.length, MAX_PROMPT_ROWS, start)

  useEffect(() => {
    const element = textRef.current
    if (element === null) return
    const measured = measureElement(element).width
    if (measured > 0 && measured !== textWidth) setTextWidth(measured)
  })

  // ↑/↓ are shared with the log; tell the App which of us owns them.
  const claimsArrows = active && (palette.length > 0 || rows.length > 1)
  useEffect(() => {
    onArrowClaimChange?.(claimsArrows)
  }, [claimsArrows, onArrowClaimChange])

  /** Move the caret one row and keep the window on it. */
  const moveCaretRow = (delta: number): void => {
    const targetRow = caret.row + delta
    const target = rows[targetRow]
    if (target === undefined) return
    // The character offset carries over, clamped to the target row. A
    // remembered "desired column" would survive a walk across short rows,
    // but it needs another piece of state to be correct and nobody has
    // asked for it yet.
    const nextCursor = target.start + Math.min(caret.offset, target.text.length)
    setCursorIndex(nextCursor)
    setScrollTop(visibleStart(rows.length, targetRow, MAX_PROMPT_ROWS, scrollTop))
  }

  // Ink's raw mode hides the terminal cursor, so we render our own.
  // Keep it stable instead of blinking: the prompt is already visually
  // distinct while active, and a 500ms re-render loop is unnecessary churn
  // on a terminal UI that has to stay smooth while scrolling the log.
  useInput(
    (input, key) => {
      // Ctrl-modified keystrokes are reserved for the App-level
      // handlers (Ctrl-C exits the REPL; Ctrl-B/F/U/D scroll the log).
      // If we let them fall through, Ctrl-C would append 'c' to the
      // buffer. Ctrl-J is the exception and never reaches here as a
      // Ctrl-keystroke: Ink parses it as the linefeed it is, so it
      // arrives as ordinary input '\n' and inserts a newline below.
      if (key.ctrl) return
      // Mouse reports reach every `useInput` handler as ordinary input
      // with the leading ESC stripped, so without this a spin of the
      // wheel types `[<64;12;30M` into the prompt. The scroll hook is
      // what acts on them; here they are simply not text.
      if (isMouseReport(input)) return
      // Esc — when the palette is open, dismiss it by clearing the
      // buffer. When the palette is closed, leave the buffer alone
      // (Esc has no other meaning in the prompt).
      if (key.escape) {
        if (palette.length > 0) {
          setValue('')
          setCursorIndex(0)
          setPaletteIndex(0)
          setScrollTop(0)
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
      // ↑/↓ — the palette first, then row movement inside a buffer that
      // occupies more than one row. On a single row they are the log's
      // (see `claimsArrows`), so bail and let the scroll hook have them.
      if (key.upArrow) {
        if (palette.length > 0) {
          setPaletteIndex(i => clampPaletteIndex(i - 1, palette))
          return
        }
        if (rows.length > 1) moveCaretRow(-1)
        return
      }
      if (key.downArrow) {
        if (palette.length > 0) {
          setPaletteIndex(i => clampPaletteIndex(i + 1, palette))
          return
        }
        if (rows.length > 1) moveCaretRow(1)
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
          const exact = palette.find(c => c.name === normalized)
          if (exact) {
            setValue('')
            setCursorIndex(0)
            setPaletteIndex(0)
            setScrollTop(0)
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
        setScrollTop(0)
        onSubmit(submitted)
        return
      }
      if (key.leftArrow) {
        setCursorIndex(i => Math.max(0, i - 1))
        return
      }
      if (key.rightArrow) {
        setCursorIndex(i => Math.min(value.length, i + 1))
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

  // The running placeholder is the same spinner glyph the StatusBar
  // uses, so the two indicators stay in lock-step. Both come from
  // the App's single `useRunningClock` interval; idle placeholder
  // is unchanged.
  const placeholder = active ? 'Ask dsh anything…' : `${SPINNER_FRAMES[spinnerFrame]} working`
  const cursor = active ? (
    <Text color="cyan" bold>
      ▌
    </Text>
  ) : null

  return (
    <Box flexDirection="column">
      {palette.length > 0 ? (
        <Box marginBottom={1}>
          <SlashPalette commands={palette} selected={safePaletteIndex} />
        </Box>
      ) : null}
      <Box borderStyle="round" borderColor={active ? 'cyan' : 'gray'} paddingX={1}>
        {/*
          The `> ` prefix marks the *start of the buffer*, so it is drawn
          only on absolute row 0. Painting it on whatever row happens to be
          at the top after scrolling would claim the buffer starts there.
        */}
        <Box flexDirection="column" flexShrink={0}>
          {visibleRows.map((_row, index) => (
            <Text key={`prefix-${start + index}`} color="cyan" bold>
              {start + index === 0 ? '> ' : '  '}
            </Text>
          ))}
        </Box>
        <Box ref={textRef} flexDirection="column" flexGrow={1} flexShrink={1}>
          {value === '' ? (
            <Text wrap="truncate">
              {cursor}
              <Text color="gray" dimColor>
                {placeholder}
              </Text>
            </Text>
          ) : (
            visibleRows.map((row, index) => {
              const absolute = start + index
              // Every row is pre-folded to the measured width, so
              // `truncate` should never fire. It is here because the
              // failure it prevents — a row Ink re-wraps, growing the box
              // past its cap — is far worse than a clipped tail.
              if (absolute !== caret.row) {
                return (
                  <Text key={absolute} wrap="truncate">
                    {row.text}
                  </Text>
                )
              }
              return (
                <Text key={absolute} wrap="truncate">
                  {row.text.slice(0, caret.offset)}
                  {cursor}
                  {row.text.slice(caret.offset)}
                </Text>
              )
            })
          )}
        </Box>
        {/*
          Reserved unconditionally, blanks included: a bar that appeared
          only on overflow would narrow the text at that moment and re-fold
          every row under the caret. Same reasoning as the message list's
          reserved hint row.
        */}
        <Box flexDirection="column" flexShrink={0}>
          {scrollbar.map((glyph, index) => (
            <Text key={`bar-${start + index}`} color="cyan" dimColor>
              {glyph}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
