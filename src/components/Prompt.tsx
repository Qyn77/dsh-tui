/**
 * The bottom input box. Single-line for v1 with a `\` + Enter continuation
 * marker; future PR can add a real multi-line editor.
 * @module @deepseek-ai/dsh-tui/components/Prompt
 */

import React, { useState, type FC } from 'react'
import { Box, Text, useInput } from 'ink'

/** Props for {@link Prompt}. */
export interface PromptProps {
  /** Whether input is accepted (false while a turn is running). */
  active: boolean
  /** Called with the full line when the user submits. */
  onSubmit: (text: string) => void
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

export const Prompt: FC<PromptProps> = ({ active, onSubmit }) => {
  const [value, setValue] = useState('')
  const [cursorIndex, setCursorIndex] = useState(0)

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
      if (key.return) {
        if (value.endsWith('\\')) {
          const next = `${value.slice(0, -1)}\n`
          setValue(next)
          setCursorIndex(next.length)
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
  const placeholder = active ? 'Ask dsh anything…' : '… working'
  const beforeCursor = value.slice(0, cursorIndex)
  const afterCursor = value.slice(cursorIndex)
  const cursor = active ? <Text color="cyan" bold>▌</Text> : null

  return (
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
  )
}
