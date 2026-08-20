/**
 * Top status bar: model, session id, agent status, accumulated token usage.
 * @module @deepseek-ai/dsh-tui/components/StatusBar
 */

import React, { type FC } from 'react'
import { Box, Text } from 'ink'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { UiState } from '../types.ts'
import { SPINNER_FRAMES } from '../hooks/useRunningClock.ts'

/** Props for {@link StatusBar}. */
export interface StatusBarProps {
  /** Currently selected model for the agent. */
  selection: ModelSelection
  /** Session id of the live agent. */
  sessionId: SessionId
  /** Live UI state — used for status + last-finished turn number. */
  state: UiState
  /** Index into {@link SPINNER_FRAMES} for the running glyph. */
  spinnerFrame: number
  /** Whole seconds since the most recent `running` transition. */
  elapsedSeconds: number
}

function shortId(id: SessionId): string {
  // The id is a branded string; show the first eight characters.
  return String(id).slice(0, 8)
}

function totalUsage(state: UiState): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const entry of state.entries) {
    if (entry.kind === 'assistant' && entry.usage) {
      input += entry.usage.inputTokens ?? 0
      output += entry.usage.outputTokens ?? 0
    }
  }
  return { input, output }
}

export const StatusBar: FC<StatusBarProps> = ({ selection, sessionId, state, spinnerFrame, elapsedSeconds }) => {
  const usage = totalUsage(state)
  const isRunning = state.status === 'running'
  // The running indicator is `⠋ working · 3s` (spinner + label +
  // elapsed-seconds counter). The glyph is a single frame from
  // `SPINNER_FRAMES` driven by the App's `useRunningClock`; the
  // counter is whole seconds and only updates once a second so a
  // long turn does not re-render at 12 fps for an unchanged value.
  // Idle stays `⏵ idle` — the same shape, no extra columns.
  const statusText = isRunning
    ? `${SPINNER_FRAMES[spinnerFrame]} working · ${elapsedSeconds}s`
    : '⏵ idle'
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Box>
        <Text color="cyan" bold>
          dsh
        </Text>
        <Text color="gray"> · </Text>
        <Text color="green">{selection.provider}/{selection.model}</Text>
      </Box>
      <Box>
        <Text color="gray">session: </Text>
        <Text>{shortId(sessionId)}</Text>
        <Text color="gray"> · </Text>
        <Text color={isRunning ? 'yellow' : 'gray'}>
          {statusText}
        </Text>
        <Text color="gray"> · </Text>
        <Text color="gray">in: </Text>
        <Text>{usage.input.toLocaleString()}</Text>
        <Text color="gray"> out: </Text>
        <Text>{usage.output.toLocaleString()}</Text>
      </Box>
    </Box>
  )
}
