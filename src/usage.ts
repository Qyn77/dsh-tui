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
import { displayWidth as width } from './width.ts'

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

/** One turn's billed tokens, with every step inside it already summed. */
export interface TurnUsage {
  /** Turn number as the session numbered it. */
  turn: number
  /** Billed input, defined as in {@link totalUsage}. */
  input: number
  /** Output tokens. */
  output: number
  /** How many assistant steps reported usage inside this turn. */
  steps: number
}

/**
 * Break the spend out turn by turn, oldest first.
 *
 * Grouped by turn rather than listed per step because a turn is the unit the
 * user typed: one question that took six tool round-trips is billed six times,
 * and a reader scanning for "which question was expensive" wants that as one
 * row. The step count stays on the row, since it is usually the *reason* a row
 * is large.
 *
 * These rows sum to {@link totalUsage} and must not be read as occupancy — each
 * turn's input restates the whole prefix, which is the mistake
 * {@link contextOccupancy} exists to avoid. Spend is additive; a context window
 * is not.
 */
export function usageByTurn(state: UiState): TurnUsage[] {
  const byTurn = new Map<number, TurnUsage>()
  for (const entry of state.entries) {
    if (entry.kind !== 'assistant' || !entry.usage) continue
    const row = byTurn.get(entry.turn) ?? { turn: entry.turn, input: 0, output: 0, steps: 0 }
    row.input += entry.usage.inputTokens
      + (entry.usage.cacheReadTokens ?? 0)
      + (entry.usage.cacheWriteTokens ?? 0)
    row.output += entry.usage.outputTokens
    row.steps += 1
    byTurn.set(entry.turn, row)
  }
  return [...byTurn.values()].sort((a, b) => a.turn - b.turn)
}

/**
 * How many turns `/usage` prints before it starts folding.
 *
 * The same policy as the output previews in §1.2: cap the height, say what was
 * left out, and never silently drop. A hundred-turn session would otherwise
 * push everything else out of the scrollback in one command.
 */
export const MAX_USAGE_ROWS = 20

/** The words {@link formatUsage} needs. Filled from the catalog. */
export interface UsageLabels {
  turn: string
  input: string
  output: string
  total: string
  /** Row standing in for the turns the cap folded away. */
  earlier: (count: number) => string
}

/**
 * Render the turns as a right-aligned table with a total row.
 *
 * The folded rows are summed into a row of their own rather than dropped, so
 * the two number columns still add up to the total a reader can check against
 * `/context`. A table whose visible rows do not sum to its own total teaches
 * the reader to distrust it.
 * @param turns - output of {@link usageByTurn}, oldest first.
 */
export function formatUsage(turns: readonly TurnUsage[], labels: UsageLabels): string {
  const shown = turns.slice(-MAX_USAGE_ROWS)
  const folded = turns.slice(0, turns.length - shown.length)
  const rows: string[][] = []
  if (folded.length > 0) {
    rows.push([
      labels.earlier(folded.length),
      sum(folded, row => row.input).toLocaleString(),
      sum(folded, row => row.output).toLocaleString(),
    ])
  }
  for (const row of shown) {
    rows.push([
      `${row.turn}${row.steps > 1 ? ` (${row.steps})` : ''}`,
      row.input.toLocaleString(),
      row.output.toLocaleString(),
    ])
  }
  const header = [labels.turn, labels.input, labels.output]
  const total = [
    labels.total,
    sum(turns, row => row.input).toLocaleString(),
    sum(turns, row => row.output).toLocaleString(),
  ]
  const all = [header, ...rows, total]
  const widths = header.map((_, column) => Math.max(...all.map(row => width(row[column] ?? ''))))
  return all.map(row => `  ${row.map((cell, column) => pad(cell, widths[column] ?? 0)).join('  ')}`)
    .join('\n')
}

function sum(rows: readonly TurnUsage[], of: (row: TurnUsage) => number): number {
  return rows.reduce((carry, row) => carry + of(row), 0)
}

/** Right-align in display columns, not characters: the labels can be CJK. */
function pad(cell: string, column: number): string {
  return ' '.repeat(Math.max(0, column - width(cell))) + cell
}
