/**
 * Top status bar — two rows inside the round brand frame.
 *
 *   ╭──────────────────────────────────────────────────────────╮
 *   │ ▄█▀▀█▄ dsh · deepseek-official/deepseek-v4-flash           │
 *   │ tui-652d · ⏵ idle · ↑ 8,558 · ↓ 198                        │
 *   ╰──────────────────────────────────────────────────────────╯
 *
 *   top    = who is answering      (brand + model)
 *   bottom = what the run is doing (session + status + tokens)
 *
 * The old two-column form spent its first content columns on translated
 * labels (`session:` / `in:` / `out:`) whose only job was to name numbers the
 * arrow glyphs now name — `↑` for tokens into the model, `↓` for tokens out —
 * in one column each and in no language, which is also why those three
 * catalog keys are gone. The one row that can overflow, the model line, is
 * width-aware (`useStdout` + `fitModelName`) and tail-truncates with a
 * leading `…` when even the bare model would not fit.
 *
 * `↑`/`↓` join `⏵` in the East-Asian Ambiguous set, and are covered by the
 * same stance the SPEC takes for it (§1.1): autowrap is off for the app's
 * lifetime, so a row that measures at the width but renders wider clips into
 * the last column instead of wrapping, and the border stays legible.
 * @module @deepseek-ai/dsh-tui/components/StatusBar
 */

import React, { type FC } from 'react'
import { Box, Text, useStdout } from 'ink'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { UiState } from '../types.ts'
import { SPINNER_FRAMES } from '../hooks/useRunningClock.ts'
import { useStrings } from '../hooks/useStrings.tsx'
import { totalUsage } from '../usage.ts'

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
 * Brand glyph for the top of the brand row. A small block-art whale echoing
 * the startup {@link Banner}'s full-size one, sized to a single terminal row
 * so the persistent chrome stays cheap.
 */
const WHALE = '▄█▀▀█▄'

/** DeepSeek's brand blue. Shared with the startup banner. */
const BRAND_BLUE = '#4D6BFE'

function shortId(id: SessionId): string {
  // The id is a branded string; show the first eight characters.
  return String(id).slice(0, 8)
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
  const strings = useStrings()
  // Ink does not surface the column count when stdout is piped, so
  // fall back to 80 — narrower than that and the user is on a phone,
  // wider and the top row still has headroom.
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
    ? `${SPINNER_FRAMES[spinnerFrame]} ${strings.status.working} · ${elapsedSeconds}s`
    : strings.status.idle
  // The model shares its row with the whale and the `·` separators, so the
  // budget is the terminal less the frame (4), the padding (2), the whale and
  // its space (6), the dsh word (3) and the separator (3). The floor of 8
  // keeps `fitModelName` room to choose a meaningful form.
  const modelBudget = Math.max(8, columns - 18)
  const displayModel = fitModelName(selection.provider, selection.model, modelBudget)
  return (
    <Box borderStyle="round" borderColor={BRAND_BLUE} paddingX={2} flexDirection="column">
      <Box>
        <Text color={BRAND_BLUE} bold>{WHALE} dsh</Text>
        <Text color="gray"> · </Text>
        <Text color="green" bold>{displayModel}</Text>
      </Box>
      <Box>
        <Text color="gray">{shortId(sessionId)}</Text>
        <Text color="gray"> · </Text>
        <Text color={isRunning ? 'yellow' : 'gray'}>{statusText}</Text>
        <Text color="gray"> · </Text>
        <Text color="gray">↑ </Text>
        <Text>{usage.input.toLocaleString()}</Text>
        <Text color="gray"> · ↓ </Text>
        <Text>{usage.output.toLocaleString()}</Text>
      </Box>
    </Box>
  )
}
