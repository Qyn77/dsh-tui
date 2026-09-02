/**
 * What the token counters mean.
 *
 * Two different questions get asked of the same `TokenUsage` records, and
 * conflating them is what made `/context`'s percentage wrong:
 *
 * - **How much have I spent?** — {@link totalUsage}, a running sum across every
 *   turn. Monotonically increasing; this is the StatusBar's `in:` / `out:`.
 * - **How full is the context?** — {@link contextOccupancy}, a reading of the
 *   *latest* turn alone. Goes down after a `/compact`; this is the only one of
 *   the two that can legitimately be divided by the context window.
 *
 * They were the same number for one turn, which is exactly long enough for the
 * mistake to look right in a test.
 * @module @deepseek-ai/dsh-tui/usage
 */

import type { UiState } from './types.ts'

/** Billed input and output, summed. */
export interface UsageTotals {
  /** Billed input tokens: uncached input plus both cache counts. */
  input: number
  /** Output tokens. */
  output: number
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
 *
 * This is a spend counter, not an occupancy gauge. See {@link contextOccupancy}.
 */
export function totalUsage(state: UiState): UsageTotals {
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
 * How many tokens the *next* request will carry, as far as the last one can say.
 *
 * The newest assistant turn's billed input already counts the whole prompt sent
 * for it — system instructions, every prior message, every tool result — so the
 * conversation as it now stands is that input plus the reply it produced. Later
 * turns do not add to it; they restate it. Summing across turns therefore counts
 * the same prefix once per turn, and `/context` used to divide that sum by the
 * window: on a long session the percentage sailed past 100% while the context
 * was half empty, and it could never go down, which made it useless for the one
 * decision it exists to inform.
 *
 * Approximate on purpose. It cannot see anything appended since the last reply
 * (a queued user message, an injected `!!` output), and it reads the number the
 * provider billed rather than a local re-tokenization. Both errors are small and
 * point the same way — it under-reports slightly — which is the safe direction
 * for a gauge whose job is to warn.
 *
 * @returns the occupancy in tokens, or `undefined` when no turn has reported
 * usage yet, which is not the same as an occupancy of zero.
 */
export function contextOccupancy(state: UiState): number | undefined {
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const entry = state.entries[index]
    if (entry.kind !== 'assistant' || !entry.usage) continue
    const { usage } = entry
    return usage.inputTokens
      + (usage.cacheReadTokens ?? 0)
      + (usage.cacheWriteTokens ?? 0)
      + usage.outputTokens
  }
  return undefined
}
