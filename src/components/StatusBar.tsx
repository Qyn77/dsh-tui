/**
 * Top status bar — two vertical columns inside a heavy cyan frame so the
 * chrome has visual weight on par with the message list below.
 *
 *   ┏━ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┓
 *   ┃                                                              ┃
 *   ┃   <°)))><                       session: tui-652d             ┃
 *   ┃   dsh                          in:        8,558               ┃
 *   ┃   DeepSeek Harness             out:         198               ┃
 *   ┃   deepseek-official/...        ⏵ idle                         ┃
 *   ┃                                                              ┃
 *   ┗━ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┛
 *
 *   left  = brand identity (logo + wordmark + tagline + model)
 *   right = runtime state  (session + tokens + status)
 *
 * The model line is width-aware (`useStdout` + `fitModelName`) and
 * tail-truncates with a leading `…` when even the bare model would
 * not fit. Status placement (bottom of the right column) is a
 * judgement call: it groups the "what is happening" with the data
 * rather than with the brand.
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
  /** Live UI state — read for `status` and for the token totals. */
  state: UiState
  /** Index into {@link SPINNER_FRAMES} for the running glyph. */
  spinnerFrame: number
  /** Whole seconds since the most recent `running` transition. */
  elapsedSeconds: number
}

/**
 * Brand glyph for the top of the brand column. A small block-art
 * whale echoing the startup {@link Banner}'s full-size one, sized to
 * a single terminal row so the persistent chrome stays cheap.
 */
const WHALE = '▄█▀▀█▄'

/** DeepSeek's brand blue. Shared with the startup banner. */
const BRAND_BLUE = '#4D6BFE'

/** Width of the right-column label column. Chosen so the numbers align. */
const LABEL_WIDTH = 'session: '.length

function shortId(id: SessionId): string {
  // The id is a branded string; show the first eight characters.
  return String(id).slice(0, 8)
}

/**
 * Sum the token usage across every assistant entry in the log.
 *
 * `input` is **billed** input, which is the sum of three disjoint counts.
 * `TokenUsage` documents them that way: `inputTokens` is uncached input only,
 * and cache hits are reported separately as `cacheReadTokens` /
 * `cacheWriteTokens`. Reading `inputTokens` alone — which this did — silently
 * under-reports, and it under-reports *worse the longer the conversation runs*,
 * because a longer prompt is a better cache hit. A user watching that number to
 * decide when to `/compact` was being shown the one component of the prompt
 * that stops growing.
 */
export function totalUsage(state: UiState): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const entry of state.entries) {
    if (entry.kind === 'assistant' && entry.usage) {
      input += entry.usage.inputTokens
      input += entry.usage.cacheReadTokens ?? 0
      input += entry.usage.cacheWriteTokens ?? 0
      // `reasoningTokens` is deliberately left out. The cache counts above are
      // documented as disjoint from `inputTokens`, which is what made adding
      // them a fix; nothing documents whether `reasoningTokens` is already
      // inside `outputTokens`. Adding it on a guess would double-count on every
      // thinking model, so it stays out until the contract says otherwise.
      output += entry.usage.outputTokens
    }
  }
  return { input, output }
}

/**
 * Pad a label so the values in the right column line up at a fixed
 * column. Local helper, not exported — only the meta column needs
 * aligned labels.
 */
function padLabel(label: string): string {
  return label.length >= LABEL_WIDTH ? label : label + ' '.repeat(LABEL_WIDTH - label.length)
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
  // wider and our 2-column layout still has headroom.
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
  // The model line is on the brand column but has the full terminal
  // width to itself: 4 cols of outer padding, 1 col breathing
  // margin, and the budget must be at least 8 so the function has
  // room to choose a meaningful form (provider/model vs bare model).
  const modelBudget = Math.max(8, columns - 5)
  const displayModel = fitModelName(selection.provider, selection.model, modelBudget)
  return (
    <Box
      borderStyle="round"
      borderColor={BRAND_BLUE}
      paddingX={2}
      flexDirection="row"
      columnGap={4}
    >
      <Box flexDirection="column">
        <Text color={BRAND_BLUE} bold>{WHALE} dsh</Text>
        <Text color="green" bold>{displayModel}</Text>
      </Box>
      <Box flexDirection="column">
        <Box>
          <Text color="gray">{padLabel('session:')}</Text>
          <Text>{shortId(sessionId)}</Text>
          <Text color="gray"> · </Text>
          <Text color={isRunning ? 'yellow' : 'gray'}>{statusText}</Text>
        </Box>
        <Box>
          <Text color="gray">{padLabel('in:')}</Text>
          <Text>{usage.input.toLocaleString()}</Text>
          <Text color="gray">{'   out: '}</Text>
          <Text>{usage.output.toLocaleString()}</Text>
        </Box>
      </Box>
    </Box>
  )
}
