/**
 * Pure vocabulary for hook runs: what a recorded decision means for how loudly
 * the transcript should say it.
 *
 * Named `hook-runs` and not `hooks` because `src/hooks/` is this package's
 * React hooks directory. Nothing here is React.
 * @module @deepseek-ai/dsh-tui/hook-runs
 */

import type { UiEntry } from './types.ts'

/** The member of {@link UiEntry} describing one hook run. */
export type HookEntry = Extract<UiEntry, { kind: 'hook' }>

/**
 * How much attention a hook run has earned.
 *
 * `quiet` is a run that let the turn proceed unchanged — an audit record, and
 * the same weight as a compaction notice. `notable` is a run that altered what
 * happened, which is the entire reason this feature exists: without the row,
 * the user is looking at a tool call that did not run and nothing on screen
 * says why.
 */
export type HookTone = 'quiet' | 'notable'

/**
 * Decisions that changed nothing.
 *
 * `pass` is what the emitter records when a hook expressed no decision at all,
 * and `allow`/`approve` are the two spellings of a hook explicitly permitting
 * what was already going to happen. Every other value in today's vocabulary
 * (`deny`, `block`, `ask`, `stop`) interrupted something.
 */
const QUIET_DECISIONS: ReadonlySet<string> = new Set(['pass', 'allow', 'approve'])

/**
 * The weight to draw one hook run at.
 *
 * An **unrecognized** decision is `notable`, not `quiet`. The emitter types
 * this field as a bare `string` because a bridge may add to the vocabulary, so
 * an unknown value is not a malformed event — it is a real decision this build
 * has no word for. Defaulting it to quiet would hide exactly the case where the
 * transcript is the only place the user could have learned something happened.
 *
 * A run still in flight, or one abandoned at the turn boundary, is `quiet`: it
 * has no decision to be loud about.
 * @param entry - the hook run to weigh.
 * @returns `notable` when the run interrupted something, `quiet` otherwise.
 */
export function hookTone(entry: HookEntry): HookTone {
  if (entry.decision === undefined) return 'quiet'
  return QUIET_DECISIONS.has(entry.decision) ? 'quiet' : 'notable'
}

/**
 * The stderr a hook run should show, or `undefined` when there is nothing.
 *
 * The emitter caps this at its bridge's `stderrSummaryMaxChars` (500 by
 * reference default) before it reaches the log, so this does no truncating of
 * its own — a second cap here would be a second number to keep in sync with
 * `estimateEntryRows` for no gain. Blank summaries are dropped so a hook that
 * wrote only whitespace does not cost a row.
 * @param entry - the hook run to read.
 * @returns the trimmed summary, or `undefined` when the run printed nothing.
 */
export function hookStderr(entry: HookEntry): string | undefined {
  const summary = entry.stderrSummary?.trim()
  return summary === undefined || summary === '' ? undefined : summary
}
