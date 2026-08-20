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
export const Prompt: FC<PromptProps> = ({ active, onSubmit }) => {
  const [value, setValue] = useState('')

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
          setValue(`${value.slice(0, -1)}\n`)
          return
        }
        const submitted = value
        setValue('')
        onSubmit(submitted)
        return
      }
      if (key.backspace || key.delete) {
        setValue(value.slice(0, -1))
        return
      }
      if (input) setValue(value + input)
    },
    { isActive: active },
  )

  const placeholder = active ? 'Ask dsh anything…' : '… working'
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
      {value === '' ? (
        <Text color="gray" dimColor>
          {placeholder}
        </Text>
      ) : (
        <Text>{value}</Text>
      )}
      {cursor}
    </Box>
  )
}
