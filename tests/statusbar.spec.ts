/**
 * Tests for the StatusBar's two pure helpers: the column-aware model-name
 * fitter, and the token accumulator behind the `in:` / `out:` numbers. The
 * StatusBar itself mounts through Ink and is covered by a manual smoke
 * (`pnpm dsh --profile tui` in a real TTY); here we lock the arithmetic
 * that decides what those columns say.
 */

import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { fitModelName, totalUsage } from '../src/components/StatusBar.tsx'
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

describe('fitModelName', () => {
  it('returns the full `provider/model` when it fits', () => {
    expect(fitModelName('dsh', 'v4', 20)).toBe('dsh/v4')
  })

  it('returns the full string unchanged when exactly at the width', () => {
    // `dsh/v4` is 6 chars; at maxWidth 6 it must still be returned
    // untouched (boundary case — using `≤` not `<`).
    expect(fitModelName('dsh', 'v4', 6)).toBe('dsh/v4')
  })

  it('drops the provider when the model alone fits', () => {
    // provider takes 16 chars, model 31 chars, total 48.
    // At maxWidth 35 the full form does not fit, but the model does.
    expect(
      fitModelName('deepseek-official', 'deepseek-v4-session:tui-b1-flash', 35),
    ).toBe('deepseek-v4-session:tui-b1-flash')
  })

  it('keeps the tail and prepends `…` when neither the full form nor the bare model fits', () => {
    // Model is 31 chars; at maxWidth 20 we must show the last 19
    // characters with a leading ellipsis so the user still sees
    // `:tui-b1-flash` (the variant tag they actually picked).
    expect(
      fitModelName('deepseek-official', 'deepseek-v4-session:tui-b1-flash', 20),
    ).toBe('…ession:tui-b1-flash')
  })

  it('falls back to the very tail when the budget is tiny', () => {
    expect(
      fitModelName('p', 'a-very-long-model-name', 10),
    ).toBe('…odel-name')
  })

  it('returns an empty string for non-positive widths', () => {
    expect(fitModelName('p', 'm', 0)).toBe('')
    expect(fitModelName('p', 'm', -3)).toBe('')
  })

  it('prefers the bare model over `…` even at very small widths', () => {
    // A 1-char model is more useful than a lone `…`: the user at
    // least sees the name. The function only emits `…` when even
    // the bare model does not fit.
    expect(fitModelName('p', 'm', 1)).toBe('m')
  })

  it('emits a lone `…` only when the model itself does not fit', () => {
    expect(fitModelName('p', 'mm', 1)).toBe('…')
  })
})
