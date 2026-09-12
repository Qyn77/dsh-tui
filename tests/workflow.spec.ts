/**
 * Workflow runs in the transcript.
 *
 * `tool-workflow/*` is the only fan-out the parent session can see. The
 * neighbouring package, `@deepseek-ai/dsh-subagent`, emits exactly one event —
 * `subagent/descriptor` — and appends it to the *child's* log, so no amount of
 * reading the parent session will find a delegation there. What the workflow
 * tool writes "into its calling parent Session" is these four events, and they
 * are what a user watching a fan-out has.
 *
 * What is pinned here is the pairing and the row budget: runs may overlap, so
 * `runId` identifies one and `seq` identifies a member inside it, and neither
 * recency nor array position may stand in for either.
 * @module @deepseek-ai/dsh-tui/tests/workflow.spec
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { UiEntry, UiState, WorkflowMember } from '../src/core/types.ts'
import { replay } from '../src/core/state.ts'
import { estimateEntryRows } from '../src/render/scroll.ts'
import { workflowMemberTone, workflowRows, type WorkflowEntry } from '../src/render/message-layout.ts'

const RUN = 'run-1'

/** One session event, shaped the way the log stores it. */
function event(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as unknown as SessionEvent
}

function runStart(runId = RUN, name = 'review-changes'): SessionEvent {
  return event('tool-workflow/run-start', { runId, name })
}

function agentStart(
  over: Partial<{ runId: string; seq: number; label: string; phase: string }> = {},
): SessionEvent {
  return event('tool-workflow/agent-start', {
    runId: over.runId ?? RUN,
    seq: over.seq ?? 1,
    label: over.label ?? 'review:bugs',
    ...(over.phase !== undefined ? { phase: over.phase } : {}),
    childId: 'child-1',
  })
}

function agentEnd(
  over: Partial<{ runId: string; seq: number; outcome: string }> = {},
): SessionEvent {
  return event('tool-workflow/agent-end', {
    runId: over.runId ?? RUN,
    seq: over.seq ?? 1,
    outcome: over.outcome ?? 'completed',
  })
}

function runEnd(over: Partial<{ runId: string; stopReason: string }> = {}): SessionEvent {
  return event('tool-workflow/run-end', {
    runId: over.runId ?? RUN,
    stopReason: over.stopReason ?? 'completed',
  })
}

function turnEnd(kind: TurnEndReason['kind']): SessionEvent {
  // `error` is the one reason carrying a payload the note reads.
  const reason = kind === 'error'
    ? { kind, error: { name: 'Error', code: 'boom' } }
    : { kind }
  return event('turn/end', { turn: 1, reason })
}

function project(...events: readonly SessionEvent[]): UiState {
  return replay(events)
}

function runsOf(state: UiState): WorkflowEntry[] {
  return state.entries.filter((e): e is WorkflowEntry => e.kind === 'workflow')
}

function onlyRun(state: UiState): WorkflowEntry {
  const runs = runsOf(state)
  expect(runs).toHaveLength(1)
  return runs[0]
}

function member(run: WorkflowEntry, seq: number): WorkflowMember {
  const found = run.members.find(m => m.seq === seq)
  if (found === undefined) throw new Error(`no member with seq ${String(seq)}`)
  return found
}

describe('projecting a workflow run', () => {
  it('opens one entry for the run and none for its members', () => {
    const state = project(runStart(), agentStart({ seq: 1 }), agentStart({ seq: 2 }))
    const run = onlyRun(state)

    expect(state.entries).toHaveLength(1)
    expect(run.name).toBe('review-changes')
    expect(run.members.map(m => m.seq)).toEqual([1, 2])
  })

  it('carries the phase when the workflow declared one, and omits it when not', () => {
    const state = project(
      runStart(),
      agentStart({ seq: 1, phase: 'Review' }),
      agentStart({ seq: 2 }),
    )
    const run = onlyRun(state)

    expect(member(run, 1).phase).toBe('Review')
    expect(member(run, 2).phase).toBeUndefined()
  })

  it('settles a member on its own seq, not on arrival order', () => {
    // Two members open, and the *second* one finishes first — the ordinary
    // case for a fan-out, and the one array position would get wrong.
    const state = project(
      runStart(),
      agentStart({ seq: 1, label: 'slow' }),
      agentStart({ seq: 2, label: 'fast' }),
      agentEnd({ seq: 2, outcome: 'failed' }),
    )
    const run = onlyRun(state)

    expect(member(run, 1).outcome).toBeUndefined()
    expect(member(run, 2).outcome).toBe('failed')
  })

  it('keeps two concurrent runs apart by runId', () => {
    const state = project(
      runStart('run-a', 'alpha'),
      runStart('run-b', 'beta'),
      agentStart({ runId: 'run-b', seq: 1, label: 'in-beta' }),
    )
    const [alpha, beta] = runsOf(state)

    expect(alpha.members).toHaveLength(0)
    expect(beta.members.map(m => m.label)).toEqual(['in-beta'])
  })

  it('closes only the run named, leaving its neighbour open', () => {
    const state = project(
      runStart('run-a'),
      runStart('run-b'),
      runEnd({ runId: 'run-a', stopReason: 'cancelled' }),
    )
    const [alpha, beta] = runsOf(state)

    expect(alpha.status).toBe('done')
    expect(alpha.stopReason).toBe('cancelled')
    expect(beta.status).toBe('running')
    expect(beta.stopReason).toBeUndefined()
  })

  it('drops a member whose run was never opened', () => {
    // A session resumed past the run-start has no name to draw a header with,
    // so there is nothing honest to invent.
    const state = project(agentStart(), agentEnd())

    expect(state.entries).toHaveLength(0)
  })

  it('drops a settlement for a seq that has no row', () => {
    const state = project(runStart(), agentEnd({ seq: 7 }))

    expect(onlyRun(state).members).toHaveLength(0)
  })

  it('refuses to reopen a closed run', () => {
    const state = project(runStart(), runEnd(), agentStart({ seq: 1 }))

    expect(onlyRun(state).members).toHaveLength(0)
  })

  it('leaves an unsettled member unsettled when its run closes', () => {
    // `stopReason` describes the run. Copying it onto the member would have
    // this build claim the emitter reported an outcome it never sent.
    const state = project(runStart(), agentStart({ seq: 1 }), runEnd({ stopReason: 'error' }))
    const run = onlyRun(state)

    expect(run.stopReason).toBe('error')
    expect(member(run, 1).outcome).toBeUndefined()
  })

  it.each<TurnEndReason['kind']>(['completed', 'interrupted', 'error'])(
    'cancels a run still open when the turn ends as %s',
    (reason) => {
      const state = project(runStart(), agentStart({ seq: 1 }), turnEnd(reason))
      const run = onlyRun(state)

      // `cancelled` whatever the reason, and with no stop word: the emitter
      // fires `run-end` after the run quiesces, so its absence means the
      // record broke rather than that the fan-out finished.
      expect(run.status).toBe('cancelled')
      expect(run.stopReason).toBeUndefined()
    },
  )

  it('leaves a run that already closed alone at the turn boundary', () => {
    const state = project(runStart(), runEnd({ stopReason: 'completed' }), turnEnd('completed'))
    const run = onlyRun(state)

    expect(run.status).toBe('done')
    expect(run.stopReason).toBe('completed')
  })
})

describe('how loudly one member is drawn', () => {
  const open: WorkflowEntry = { kind: 'workflow', runId: RUN, name: 'w', members: [], status: 'running' }
  const closed: WorkflowEntry = { ...open, status: 'done', stopReason: 'completed' }

  it('is quiet only for completed', () => {
    expect(workflowMemberTone({ seq: 1, label: 'a', outcome: 'completed' }, closed)).toBe('ok')
  })

  it.each(['failed', 'cancelled'])('is notable for %s', (outcome) => {
    expect(workflowMemberTone({ seq: 1, label: 'a', outcome }, closed)).toBe('notable')
  })

  it('is notable for an outcome this build has never heard of', () => {
    // The emitter may grow its vocabulary. A word we cannot name is the last
    // thing to draw as if nothing happened.
    expect(workflowMemberTone({ seq: 1, label: 'a', outcome: 'quarantined' }, closed))
      .toBe('notable')
  })

  it('separates a member still working from one its run left behind', () => {
    expect(workflowMemberTone({ seq: 1, label: 'a' }, open)).toBe('pending')
    expect(workflowMemberTone({ seq: 1, label: 'a' }, closed)).toBe('abandoned')
  })
})

describe('what a workflow run costs in rows', () => {
  it('charges its header, one row per member, and a close once it has closed', () => {
    const state = project(
      runStart(),
      agentStart({ seq: 1 }),
      agentStart({ seq: 2 }),
      agentStart({ seq: 3 }),
    )
    const open = onlyRun(state)
    expect(workflowRows(open)).toBe(4)

    const done = { ...open, status: 'done' as const, stopReason: 'completed' }
    expect(workflowRows(done)).toBe(5)
  })

  it('agrees with the scroll estimate at every width', () => {
    const bare = onlyRun(project(runStart(), runEnd())) as UiEntry
    const withMember = onlyRun(project(
      runStart(),
      agentStart({ seq: 1, phase: 'Review' }),
      agentEnd(),
      runEnd(),
    )) as UiEntry

    // Every row is drawn truncated, so no width and no label length can turn
    // one row into two — which is the property paging inverts against. Stated
    // as a difference so the entry's own margin stays the margin's business.
    for (const columns of [40, 80, 200]) {
      expect(estimateEntryRows(withMember, columns))
        .toBe(estimateEntryRows(bare, columns) + 1)
    }
  })

  it('charges a thirty-agent fan-out thirty rows, not thirty transcripts', () => {
    const events: SessionEvent[] = [runStart()]
    for (let seq = 1; seq <= 30; seq += 1) {
      events.push(agentStart({ seq, label: `agent-${String(seq)}` }), agentEnd({ seq }))
    }
    events.push(runEnd())

    expect(workflowRows(onlyRun(project(...events)))).toBe(32)
  })
})
