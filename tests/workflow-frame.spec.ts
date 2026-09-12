/**
 * How a workflow run looks on screen.
 *
 * The projection is pinned in `workflow.spec.ts`; what this file asks is
 * whether the composed frame reads as *one* fan-out with its agents inside it.
 * Three things can only be seen here: that the member rows sit under the run
 * header with no blank row prising them apart, that a run the user interrupted
 * says so instead of leaving agents spinning, and that a thirty-agent fan-out
 * does not push the frame past the height Ink erases.
 * @module @qiao-qyn/dsh-tui/tests/workflow-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

type Painted = Awaited<ReturnType<typeof paintApp>>

const RUN = 'run-1'

async function fanOut(
  painted: Painted,
  members: readonly { label: string; phase?: string; outcome?: string }[],
  over: { name?: string; stopReason?: string } = {},
): Promise<void> {
  await painted.append('tool-workflow/run-start', {
    runId: RUN,
    name: over.name ?? 'review-changes',
  })
  for (const [index, m] of members.entries()) {
    const seq = index + 1
    await painted.append('tool-workflow/agent-start', {
      runId: RUN,
      seq,
      label: m.label,
      ...(m.phase !== undefined ? { phase: m.phase } : {}),
      childId: `child-${String(seq)}`,
    })
    if (m.outcome !== undefined) {
      await painted.append('tool-workflow/agent-end', { runId: RUN, seq, outcome: m.outcome })
    }
  }
  if (over.stopReason !== undefined) {
    await painted.append('tool-workflow/run-end', { runId: RUN, stopReason: over.stopReason })
  }
}

describe('a workflow run in the transcript', () => {
  it('names the workflow and every agent it published', async () => {
    const painted = await paintApp({ rows: 40 })
    await fanOut(painted, [
      { label: 'review:bugs', phase: 'Review', outcome: 'completed' },
      { label: 'review:perf', phase: 'Review', outcome: 'failed' },
    ], { stopReason: 'completed' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('review-changes')
    expect(screen).toContain('review:bugs')
    expect(screen).toContain('review:perf')
    expect(screen).toContain('Review')
  })

  it('keeps the members welded to their run, with no blank row between', async () => {
    const painted = await paintApp({ rows: 40 })
    await fanOut(painted, [{ label: 'review:bugs', outcome: 'completed' }])
    const lines = painted.screen().split('\n')
    painted.unmount()

    const header = lines.findIndex(line => line.includes('review-changes'))
    expect(header).toBeGreaterThan(-1)
    // The very next row, not one after a separating margin — a member is part
    // of the run, not an entry of its own.
    expect(lines[header + 1]).toContain('review:bugs')
  })

  it('prints the outcome in the emitter\'s own word, including one it invented', async () => {
    const painted = await paintApp({ rows: 40 })
    await fanOut(painted, [{ label: 'odd', outcome: 'quarantined' }], { stopReason: 'completed' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('quarantined')
  })

  it('says an interrupted run had no result rather than leaving it open', async () => {
    const painted = await paintApp({ rows: 40 })
    await fanOut(painted, [{ label: 'review:bugs' }])
    await painted.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    const screen = painted.screen()
    painted.unmount()

    // The run closed without a stop word, and its unsettled member says it
    // has no outcome instead of still claiming to be running.
    expect(screen).toContain('no result')
    expect(screen).toContain('no outcome')
    expect(screen).not.toContain('running…')
  })

  it('leaves the frame its own height when a workflow fans out wide', async () => {
    const rows = 24
    const painted = await paintApp({ rows })
    await fanOut(painted, Array.from({ length: 30 }, (_, index) => ({
      label: `agent-${String(index)}`,
      outcome: 'completed',
    })), { stopReason: 'completed' })
    const lines = painted.screen().split('\n')
    painted.unmount()

    // The App's root box is `rows - 3` tall and Yoga overlaps rather than
    // scrolls an overflowing subtree, so a member list that outgrew the
    // viewport would print two things on one line rather than clip.
    expect(lines.length).toBeLessThanOrEqual(rows)
  })
})
