/**
 * Top status bar — three vertical rows inside a heavy cyan frame so the
 * chrome has visual weight on par with the message list below. The rows
 * are width-aware and never collide:
 *   1. Brand row — whale glyph + dsh wordmark + DeepSeek Harness tagline.
 *   2. Model row — `provider/model`, tail-truncated with `…` when too long.
 *   3. Status row — session id, run state, in/out token totals.
 * Long model names cannot push anything off the right edge because row
 * 2 has the full terminal width to itself and the truncation is the only
 * knob (no other element competes for space on that line).
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

/**
 * Brand glyph for the top row. The classic ASCII whale `<°)))><` reads
 * as "head, eye, three water waves, tail" and is the visual nod to
 * DeepSeek's mascot. It is 8 columns wide and ASCII-only, so it
 * renders identically across the terminals we support.
 */
const WHALE = '<°)))><'

/** Tagline shown on the brand row, after the `dsh` wordmark. */
const TAGLINE = 'DeepSeek Harness'

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

/**
 * Width of the left-padded brand prefix on row 1: `  <°)))><  dsh · `
 * (two leading spaces, whale, two spaces, wordmark, separator, space).
 * Counted by hand so the brand row stays visually anchored even on
 * narrow terminals where the tagline might wrap or be trimmed.
 */
const BRAND_PREFIX_WIDTH = '  <°)))><  dsh · '.length

export const StatusBar: FC<StatusBarProps> = ({ selection, sessionId, state, spinnerFrame, elapsedSeconds }) => {
  const { stdout } = useStdout()
  // Ink does not surface the column count when stdout is piped, so
  // fall back to 80 — narrower than that and the user is on a phone,
  // wider and our default 3-line layout still leaves headroom.
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
  // The model row gets the full terminal width minus the heavy
  // border (2 cols), the padding (4 cols), and a 1-col breathing
  // margin. Truncation is the only knob: there is no other element
  // on the model row, so a long model can never collide with
  // anything on the right.
  const modelBudget = Math.max(8, columns - 7)
  const displayModel = fitModelName(selection.provider, selection.model, modelBudget)
  // The brand row reserves its own budget for the tagline; on a
  // narrow terminal we drop the tagline and leave just the wordmark,
  // so the identity never gets clipped — only the descriptor.
  const taglineBudget = Math.max(0, columns - 7 - BRAND_PREFIX_WIDTH)
  const displayTagline = TAGLINE.length <= taglineBudget ? TAGLINE : ''
  return (
    <Box
      borderStyle="bold"
      borderColor="cyan"
      paddingX={2}
      flexDirection="column"
    >
      <Box>
        <Text color="cyan" bold>{WHALE}</Text>
        <Text>{'  '}</Text>
        <Text color="cyan" bold>dsh</Text>
        {displayTagline !== '' ? (
          <>
            <Text color="gray"> · </Text>
            <Text color="cyan">{displayTagline}</Text>
          </>
        ) : null}
      </Box>
      <Box>
        <Text color="green" bold>{displayModel}</Text>
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
