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
import {
  MAX_USAGE_ROWS,
  contextOccupancy,
  formatUsage,
  totalUsage,
  usageByTurn,
} from '../src/usage.ts'
import type { UiState } from '../src/types.ts'
import { displayWidth } from '../src/width.ts'

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

/** A state whose assistant entries carry the given `(turn, in, out)` triples. */
function withTurns(...steps: readonly [number, number, number][]): UiState {
  return {
    entries: steps.map(([turn, input, output], i) => ({
      kind: 'assistant' as const,
      turn,
      step: i,
      text: 'hi',
      finalized: true,
      usage: { inputTokens: input, outputTokens: output } as TokenUsage,
    })),
    status: 'idle',
    currentTurn: steps.length,
  }
}

const LABELS = {
  turn: 'turn',
  input: 'input',
  output: 'output',
  total: 'total',
  earlier: (count: number) => `+${count} earlier`,
}

describe('usageByTurn', () => {
  it('sums the steps inside one turn into one row', () => {
    // A question that took three tool round-trips is billed three times, and
    // the reader asked about the question, not the round-trips.
    const rows = usageByTurn(withTurns([1, 100, 10], [1, 200, 20], [1, 300, 30]))
    expect(rows).toEqual([{ turn: 1, input: 600, output: 60, steps: 3 }])
  })

  it('counts cache reads and writes as input, as the totals do', () => {
    const state: UiState = {
      entries: [{
        kind: 'assistant', turn: 1, step: 0, text: 'hi', finalized: true,
        usage: {
          inputTokens: 10, outputTokens: 1, cacheReadTokens: 100, cacheWriteTokens: 1000,
        },
      }],
      status: 'idle',
      currentTurn: 1,
    }
    expect(usageByTurn(state)[0]?.input).toBe(1110)
  })

  it('orders by turn number, not by position in the log', () => {
    const rows = usageByTurn(withTurns([3, 1, 1], [1, 2, 2], [2, 3, 3]))
    expect(rows.map(row => row.turn)).toEqual([1, 2, 3])
  })

  it('sums to the same figures totalUsage reports', () => {
    // The two are different views of one fact; if they disagree, one is a bug.
    const state = withTurns([1, 100, 10], [2, 200, 20], [2, 5, 5])
    const rows = usageByTurn(state)
    const totals = totalUsage(state)
    expect(rows.reduce((n, row) => n + row.input, 0)).toBe(totals.input)
    expect(rows.reduce((n, row) => n + row.output, 0)).toBe(totals.output)
  })

  it('skips entries with no usage rather than inventing a zero row', () => {
    const state: UiState = {
      entries: [
        { kind: 'assistant', turn: 1, step: 0, text: 'hi', finalized: false },
        { kind: 'user', message: { role: 'user', content: 'hi' } as never },
      ],
      status: 'idle',
      currentTurn: 1,
    }
    expect(usageByTurn(state)).toEqual([])
  })
})

describe('formatUsage', () => {
  it('right-aligns the number columns under their headers', () => {
    const rows = usageByTurn(withTurns([1, 7, 7], [2, 123456, 9]))
    // Every column is padded to a common width, so every rendered line ends in
    // the same place — that is what "aligned" means here, and it is checkable
    // without pinning the exact spacing.
    const lines = formatUsage(rows, LABELS).split('\n')
    expect(new Set(lines.map(displayWidth)).size).toBe(1)
  })

  it('marks a turn that took several steps', () => {
    const rows = usageByTurn(withTurns([1, 1, 1], [1, 1, 1]))
    expect(formatUsage(rows, LABELS)).toMatch(/1 \(2\)/)
  })

  it('leaves a single-step turn unmarked', () => {
    expect(formatUsage(usageByTurn(withTurns([1, 1, 1])), LABELS)).not.toContain('(1)')
  })

  it('ends with a total row that adds the visible columns up', () => {
    const rows = usageByTurn(withTurns([1, 100, 10], [2, 200, 20]))
    const last = formatUsage(rows, LABELS).split('\n').at(-1)
    expect(last).toContain('total')
    expect(last).toContain('300')
    expect(last).toContain('30')
  })

  it('folds turns beyond the cap into one row rather than dropping them', () => {
    // The visible rows must still sum to the total, or the table teaches the
    // reader to distrust its own arithmetic.
    const steps = Array.from({ length: MAX_USAGE_ROWS + 5 }, (_, i): [number, number, number] =>
      [i + 1, 10, 1])
    const lines = formatUsage(usageByTurn(withTurns(...steps)), LABELS).split('\n')
    expect(lines[1]).toContain('+5 earlier')
    expect(lines[1]).toContain('50')
    // header + folded + cap + total
    expect(lines).toHaveLength(MAX_USAGE_ROWS + 3)
    expect(lines.at(-1)).toContain('250')
  })

  it('prints no fold row when everything fits', () => {
    const rows = usageByTurn(withTurns([1, 1, 1]))
    expect(formatUsage(rows, LABELS)).not.toContain('earlier')
  })

  it('aligns CJK labels by display column, not character count', () => {
    const rows = usageByTurn(withTurns([1, 100, 10]))
    // `轮次` is two characters but four columns. A `padEnd` on character count
    // would leave the header two columns wider than every row under it.
    const lines = formatUsage(rows, { ...LABELS, turn: '轮次', total: '合计' }).split('\n')
    expect(new Set(lines.map(displayWidth)).size).toBe(1)
  })
})
