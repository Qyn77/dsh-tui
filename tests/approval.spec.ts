/**
 * The approval projection.
 *
 * `approval/asked`, `approval/decided` and `approval/policy` are log-only:
 * `deriveMessages()` skips them, the model never sees them, and the live
 * `ApprovalPrompt` card is gone the instant it is answered. The transcript is
 * therefore the only place a decision survives, and a resumed session that
 * does not draw these rows silently loses the record of what was authorised.
 *
 * What is pinned here is the pairing — by `id`, because several questions can
 * be in flight — and the tone rule: only an explicit grant is quiet.
 * @module @deepseek-ai/dsh-tui/tests/approval.spec
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { UiEntry, UiState } from '../src/core/types.ts'
import { replay } from '../src/core/state.ts'
import { estimateEntryRows } from '../src/render/scroll.ts'
import { approvalRows, approvalTone, type ApprovalEntry } from '../src/render/message-layout.ts'

const ID = 'ask-1'

/** One session event, shaped the way the log stores it. */
function event(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as unknown as SessionEvent
}

function asked(
  over: Partial<{ id: string; toolName: string; callId: string; reason: string }> = {},
): SessionEvent {
  return event('approval/asked', {
    id: over.id ?? ID,
    toolName: over.toolName ?? 'shell',
    ...(over.callId !== undefined ? { callId: over.callId } : {}),
    ...(over.reason !== undefined ? { reason: over.reason } : {}),
  })
}

function decided(outcome: string, id = ID): SessionEvent {
  return event('approval/decided', { id, outcome })
}

function policy(policy: string, source = 'command'): SessionEvent {
  return event('approval/policy', { policy, source })
}

/**
 * The policy event `dsh-permission-presets` appends while constructing a
 * session that carries none. Byte-identical to a switch — `dsh-user-approval`
 * declares `source?: 'delegation'` and nothing else — which is why the reducer
 * tells them apart by position and every switch test has to open with one.
 */
function seed(value = 'ask'): SessionEvent {
  return event('approval/policy', { policy: value })
}

function turnEnd(kind: TurnEndReason['kind'] = 'completed'): SessionEvent {
  const reason = kind === 'error'
    ? { kind, error: { name: 'Error', code: 'boom' } }
    : { kind }
  return event('turn/end', { reason })
}

function project(events: readonly SessionEvent[]): UiState {
  return replay([event('turn/start', {}), ...events])
}

function approvalsOf(state: UiState): readonly ApprovalEntry[] {
  return state.entries.filter((e): e is ApprovalEntry => e.kind === 'approval')
}

function policyRows(state: UiState): readonly Extract<UiEntry, { kind: 'approval-policy' }>[] {
  return state.entries.filter(
    (e): e is Extract<UiEntry, { kind: 'approval-policy' }> => e.kind === 'approval-policy',
  )
}

function only(state: UiState): ApprovalEntry {
  const rows = approvalsOf(state)
  if (rows.length !== 1) throw new Error(`expected exactly one approval row, found ${rows.length}`)
  const row = rows[0]
  if (row === undefined) throw new Error('no approval row')
  return row
}

describe('the approval projection', () => {
  it('opens one row per question and keeps it running until decided', () => {
    const row = only(project([asked()]))
    expect(row.toolName).toBe('shell')
    expect(row.status).toBe('running')
    expect(row.outcome).toBeUndefined()
  })

  it('carries the asker\'s reason and the call it is about', () => {
    const row = only(project([asked({ callId: 'call-7', reason: 'writes outside the workspace' })]))
    expect(row.callId).toBe('call-7')
    expect(row.reason).toBe('writes outside the workspace')
  })

  it('settles the question the decision names, not the most recent one', () => {
    // Two questions in flight. The service issues one id per request() call
    // and documents that several may overlap, so closing "the newest open row"
    // would file one tool's answer against another tool's name.
    const state = project([
      asked({ id: 'a', toolName: 'shell' }),
      asked({ id: 'b', toolName: 'write' }),
      decided('rejected', 'a'),
    ])
    const rows = approvalsOf(state)
    expect(rows.map(r => [r.toolName, r.status, r.outcome])).toEqual([
      ['shell', 'done', 'rejected'],
      ['write', 'running', undefined],
    ])
  })

  it('drops a decision with no open question rather than inventing a row', () => {
    // `hook/result`'s rule. Exactly one decided per asked is documented, so an
    // unmatched one means the pair broke — and a row reading "a question you
    // never saw was answered" names nothing the user can act on.
    expect(approvalsOf(project([decided('allowed-once')]))).toHaveLength(0)
  })

  it('refuses to reopen a settled question', () => {
    const row = only(project([asked(), decided('allowed-once'), decided('rejected')]))
    expect(row.outcome).toBe('allowed-once')
    expect(row.status).toBe('done')
  })

  it.each<TurnEndReason['kind']>(['completed', 'interrupted', 'error'])(
    'cancels a question still open at turn/end (%s) without giving it an outcome',
    (kind) => {
      const row = only(project([asked(), turnEnd(kind)]))
      expect(row.status).toBe('cancelled')
      // Not 'cancelled' as an *outcome*: the service has its own `cancelled`
      // decision, and a row that fabricated one would be indistinguishable
      // from a question the service actually answered that way.
      expect(row.outcome).toBeUndefined()
    },
  )

  it('records a policy switch as its own row, tagged when it was delegated', () => {
    // `seed()` first: the row is a *switch*, and the log's opening policy event
    // is the value the session started at, not a switch to it.
    const state = project([seed(), policy('never'), policy('ask', 'delegation')])
    const rows = policyRows(state)
    expect(rows.map(r => [r.policy, r.delegated])).toEqual([['never', false], ['ask', true]])
  })

  it('draws no row for the policy a session opens under', () => {
    // The regression this rule exists for. `dsh-permission-presets` appends
    // `approval/policy` while constructing any session that carries none, so in
    // an assembly that mounts it *every* boot log opens with a policy event.
    // Drawing it put an entry on screen before the user had typed, and the
    // splash banner draws only while there are no entries — so the seed retired
    // the banner in exactly the assemblies that ship presets, while the fixture
    // agent in `fake-tty.ts` (whose log starts empty) saw none of it.
    expect(policyRows(project([seed()]))).toHaveLength(0)
  })

  it('adopts the seeded policy, so the first real switch still draws', () => {
    expect(policyRows(project([seed('ask'), policy('never')])).map(r => r.policy)).toEqual(['never'])
  })

  it('says nothing when a policy event repeats the policy already in force', () => {
    // Whole-value events, replayed: the emitter is free to restate the current
    // policy, and a row per restatement would read as a switch that never
    // happened.
    expect(policyRows(project([seed('ask'), policy('ask'), policy('ask')]))).toHaveLength(0)
  })

  it('draws a delegated override wherever it lands, changed value or not', () => {
    // `delegated` is not about the value — it says the policy was pushed in at
    // delegation rather than chosen here, which is news whether or not the word
    // moved. It is also the one thing the payload marks, and the presets seed
    // never marks it, so it is exempt from the first-event rule above.
    const rows = policyRows(project([seed('never'), policy('never', 'delegation')]))
    expect(rows.map(r => [r.policy, r.delegated])).toEqual([['never', true]])
    expect(policyRows(project([policy('ask', 'delegation')]))).toHaveLength(1)
  })
})

describe('approvalTone', () => {
  it('is quiet for the one grant the vocabulary defines', () => {
    expect(approvalTone(only(project([asked(), decided('allowed-once')])))).toBe('quiet')
  })

  it('is quiet while the question is still open — nothing to be loud about yet', () => {
    expect(approvalTone(only(project([asked()])))).toBe('quiet')
  })

  it.each(['rejected', 'cancelled', 'unavailable'])('is notable for %s', (outcome) => {
    expect(approvalTone(only(project([asked(), decided(outcome)])))).toBe('notable')
  })

  it('is notable for an outcome this build has never heard of', () => {
    // `hookTone`'s rule, the fourth time: an unknown word is a word the build
    // cannot promise is harmless, so it is shown rather than dimmed away.
    expect(approvalTone(only(project([asked(), decided('escalated')])))).toBe('notable')
  })
})

describe('the approval row budget', () => {
  const measure = (text: string, width: number) => Math.max(1, Math.ceil(text.length / width))

  it('costs one row when the asker gave no reason', () => {
    expect(approvalRows(only(project([asked()])), 40, measure)).toBe(1)
  })

  it('charges a reason by wrapping, and a blank reason not at all', () => {
    const long = only(project([asked({ reason: 'x'.repeat(85) })]))
    expect(approvalRows(long, 40, measure)).toBe(1 + 3)
    expect(approvalRows(only(project([asked({ reason: '   ' })])), 40, measure)).toBe(1)
  })

  it('is what estimateEntryRows charges, so paging stays invertible', () => {
    // Against a reasonless baseline rather than an absolute: every entry also
    // carries a marginTop row, which is the margin's business, not ours.
    const bare = only(project([asked()]))
    const withReason = only(project([asked({ reason: 'y'.repeat(85) })]))
    expect(estimateEntryRows(withReason, 40)).toBe(estimateEntryRows(bare, 40) + 3)
  })

  it('charges a policy row exactly one row at any width', () => {
    const state = project([seed(), policy('never')])
    const row = state.entries.find(e => e.kind === 'approval-policy')
    if (row === undefined) throw new Error('no policy row')
    expect(estimateEntryRows(row, 20)).toBe(estimateEntryRows(row, 120))
  })
})
