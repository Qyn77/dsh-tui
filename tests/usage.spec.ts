/**
 * The two token questions, kept apart.
 *
 * `/context`'s percentage was cumulative: it divided the sum of every turn's
 * billed input by the window, so it climbed past 100% on a long session and
 * could never fall after a `/compact`. The sum and the occupancy are the same
 * number for exactly one turn, which is why the bug read as correct — so the
 * cases below that matter most are the multi-turn ones.
 */

import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { contextOccupancy, totalUsage } from '../src/usage.ts'
import type { UiState } from '../src/types.ts'

/** A state holding one assistant entry with the given usage. */
function withUsage(...usages: readonly TokenUsage[]): UiState {
  return {
    entries: usages.map((usage, i) => ({
      kind: 'assistant' as const,
      turn: i + 1,
      step: 0,
      text: 'hi',
      finalized: true,
      usage,
    })),
    status: 'idle',
    currentTurn: usages.length,
  }
}

describe('totalUsage', () => {
  it('counts cache reads and writes as input', () => {
    // The defect this case exists for. `TokenUsage` documents the three input
    // counts as disjoint — `inputTokens` is *uncached* input only — so reading
    // it alone reported 10 where the prompt was really 1010 tokens.
    const total = totalUsage(withUsage({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
    }))
    expect(total.input).toBe(1010)
    expect(total.output).toBe(5)
  })

  it('leaves the reasoning count out of the output total', () => {
    // Not an oversight: nothing documents whether `reasoningTokens` is already
    // inside `outputTokens`, and adding it on a guess would double-count every
    // thinking model. Pinned so the omission stays a decision, not a drift.
    const total = totalUsage(withUsage({ inputTokens: 1, outputTokens: 20, reasoningTokens: 15 }))
    expect(total.output).toBe(20)
  })

  it('treats the absent cache fields as zero rather than NaN', () => {
    const total = totalUsage(withUsage({ inputTokens: 7, outputTokens: 3 }))
    expect(total).toEqual({ input: 7, output: 3 })
  })

  it('sums across turns', () => {
    const total = totalUsage(withUsage(
      { inputTokens: 1, outputTokens: 2, cacheReadTokens: 10 },
      { inputTokens: 3, outputTokens: 4, cacheReadTokens: 20 },
    ))
    expect(total).toEqual({ input: 34, output: 6 })
  })

  it('is zero for a log with no assistant usage at all', () => {
    expect(totalUsage({ entries: [], status: 'idle', currentTurn: 0 })).toEqual({ input: 0, output: 0 })
  })
})


describe('contextOccupancy', () => {
  it('reads the newest turn alone, because that turn already carried the whole prefix', () => {
    // Three turns of a growing conversation. The cumulative sum is 3,300; the
    // context actually holds the last prompt plus its reply, 2,100.
    const state = withUsage(
      { inputTokens: 100, outputTokens: 50 },
      { inputTokens: 600, outputTokens: 50 },
      { inputTokens: 2_000, outputTokens: 100 },
    )
    expect(totalUsage(state).input).toBe(2_700)
    expect(contextOccupancy(state)).toBe(2_100)
  })

  it('counts cache hits, which is most of a long prompt', () => {
    const state = withUsage({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 900,
      cacheWriteTokens: 100,
    })
    expect(contextOccupancy(state)).toBe(1_015)
  })

  it('falls after a compaction, which the cumulative sum can never do', () => {
    // The property the percentage exists for. A `/compact` shrinks the next
    // prompt; a gauge that cannot show that is not a gauge.
    const state = withUsage(
      { inputTokens: 9_000, outputTokens: 200 },
      { inputTokens: 1_200, outputTokens: 100 },
    )
    expect(contextOccupancy(state)).toBe(1_300)
    expect(totalUsage(state).input).toBeGreaterThan(contextOccupancy(state) ?? 0)
  })

  it('skips a trailing turn that reported no usage rather than reading zero', () => {
    const state = withUsage({ inputTokens: 500, outputTokens: 20 })
    state.entries.push({ kind: 'assistant', turn: 2, step: 0, text: 'streaming', finalized: false })
    expect(contextOccupancy(state)).toBe(520)
  })

  it('is undefined before any turn has reported, which is not an occupancy of zero', () => {
    // `/context` uses this to omit the line entirely. A `0%` on a fresh session
    // would be a claim about the window; silence is the honest answer.
    expect(contextOccupancy({ entries: [], status: 'idle', currentTurn: 0 })).toBeUndefined()
  })
})
