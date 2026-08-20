/**
 * Top status bar: model on the first line, session id, agent status,
 * and token counts on the second. Two-line layout so a long model
 * name can never push the rest of the chrome off the right edge or
 * wrap individual segments (e.g. splitting `in: 1,381` across two
 * rows). The model line is width-aware and falls back to a tail
 * truncation when the full `provider/model` would not fit.
 * @module @deepseek-ai/dsh-tui/components/StatusBar
 */

import React, { type FC } from 'react'
import { Box, Text, useStdout } from 'ink'
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

/**
 * Fit `provider/model` into `maxWidth` columns. Strategy:
 * 1. If the full string fits, return it.
 * 2. Drop the provider prefix — the model usually carries enough
 *    identity on its own (especially when the variant tag is in the
 *    tail, e.g. `:tui-b1-flash`).
 * 3. Otherwise, keep the tail and prepend `…` so the user still sees
 *    the model "tag" they picked, not a mid-word cut.
 *
 * The `…` is a single column in terminals we have tested; the
 * function is column-unaware because model names are ASCII in
 * practice. If a future model ships a CJK name, swap `.length` for
 * a width library — the call sites do not need to change.
 */
export function fitModelName(provider: string, model: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  const full = `${provider}/${model}`
  if (full.length <= maxWidth) return full
  if (model.length <= maxWidth) return model
  if (maxWidth === 1) return '…'
  return `…${model.slice(-(maxWidth - 1))}`
}

export const StatusBar: FC<StatusBarProps> = ({ selection, sessionId, state, spinnerFrame, elapsedSeconds }) => {
  const { stdout } = useStdout()
  // Ink does not surface the column count when stdout is piped, so
  // fall back to 80 — narrower than that and the user is on a phone,
  // wider and our default 2-line layout still leaves headroom.
  const columns = stdout?.columns ?? 80
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
  // The model line gets the full terminal width minus the border
  // padding, the `ds · ` prefix (5 cols), and a 1-col breathing
  // margin. Truncation is the only knob: there is no other element
  // on the first row, so a long model can never collide with
  // anything on the right.
  const modelBudget = Math.max(8, columns - 6)
  const displayModel = fitModelName(selection.provider, selection.model, modelBudget)
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      flexDirection="column"
    >
      <Box>
        <Text color="cyan" bold>
          dsh
        </Text>
        <Text color="gray"> · </Text>
        <Text color="green">{displayModel}</Text>
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
