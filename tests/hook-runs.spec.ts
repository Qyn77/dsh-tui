/**
 * Hook runs: `hook/invoked` and `hook/result` become one projected row, paired
 * on `handlerId`, and a run whose result never arrives is settled rather than
 * left claiming to be running.
 */

import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { replay } from '../src/state.ts'
import { hookStderr, hookTone, type HookEntry } from '../src/hook-runs.ts'
import { estimateEntryRows } from '../src/scroll.ts'
import { isRenderable } from '../src/types.ts'

function makeSession(): Session {
  return Session.create('tui-test' as never)
}

function invoke(
  session: Session,
  handlerId: string,
  point = 'PreToolUse',
  matcher?: string,
): void {
  session.append('hook/invoked', {
    turn: 1,
    point,
    dialect: 'claude-code',
    handlerId,
    ...(matcher !== undefined ? { matcher } : {}),
  })
}

function settle(
  session: Session,
  handlerId: string,
  decision: string,
  extra: { exitCode?: number; stderrSummary?: string } = {},
): void {
  session.append('hook/result', {
    turn: 1,
    point: 'PreToolUse',
    handlerId,
    decision,
    durationMs: 42,
    ...extra,
  })
}

/** The projected hook rows, in order. */
function hookRows(session: Session): HookEntry[] {
  return replay(session.events).entries.filter((e): e is HookEntry => e.kind === 'hook')
}

describe('hook run projection', () => {
  it('renders both halves of the pair as one row', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'h1')
    settle(session, 'h1', 'pass')
    const rows = hookRows(session)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'hook',
      handlerId: 'h1',
      point: 'PreToolUse',
      dialect: 'claude-code',
      decision: 'pass',
      durationMs: 42,
      status: 'done',
    })
  })

  it('is open until its result lands', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'h1')
    const rows = hookRows(session)
    expect(rows[0]).toMatchObject({ status: 'running' })
    expect(rows[0]?.decision).toBeUndefined()
    expect(rows[0]?.durationMs).toBeUndefined()
  })

  // The reason the pairing is by id and not by "the most recent open one" the
  // way `tool/result` has to be: hooks matched to one point run as a group.
  it('closes the run named by handlerId, not the newest open one', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'first')
    invoke(session, 'second')
    settle(session, 'first', 'deny')
    const rows = hookRows(session)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ handlerId: 'first', decision: 'deny', status: 'done' })
    expect(rows[1]).toMatchObject({ handlerId: 'second', status: 'running' })
  })

  it('drops a result with no open run rather than inventing a row', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    settle(session, 'never-invoked', 'deny')
    expect(hookRows(session)).toHaveLength(0)
  })

  it('does not reopen a run its own result already closed', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'h1')
    settle(session, 'h1', 'pass')
    settle(session, 'h1', 'deny')
    const rows = hookRows(session)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ decision: 'pass' })
  })

  it('carries the matcher when the group had one, and omits it otherwise', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'h1', 'PreToolUse', 'Bash')
    invoke(session, 'h2')
    const rows = hookRows(session)
    expect(rows[0]?.matcher).toBe('Bash')
    expect(rows[1]?.matcher).toBeUndefined()
  })
})

describe('a hook run open when the turn ends', () => {
  // An open tool inherits the turn's fate, so a turn that *completed* leaves
  // its tools `ok`. A hook must not borrow that: the pair is documented
  // turn-enclosed, so a missing result means the pair broke, and printing
  // `pass` would claim a verdict that was never recorded.
  it('is cancelled even when the turn completed cleanly', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'h1')
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const rows = hookRows(session)
    expect(rows[0]).toMatchObject({ status: 'cancelled' })
    expect(rows[0]?.decision).toBeUndefined()
  })

  it('leaves a run that did finish alone', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'h1')
    settle(session, 'h1', 'deny')
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    expect(hookRows(session)[0]).toMatchObject({ status: 'done', decision: 'deny' })
  })
})

describe('hookTone', () => {
  const run = (decision?: string): HookEntry => ({
    kind: 'hook',
    handlerId: 'h',
    point: 'PreToolUse',
    dialect: 'claude-code',
    turn: 1,
    status: decision === undefined ? 'running' : 'done',
    ...(decision !== undefined ? { decision } : {}),
  })

  it('treats the decisions that changed nothing as quiet', () => {
    for (const d of ['pass', 'allow', 'approve']) {
      expect(hookTone(run(d))).toBe('quiet')
    }
  })

  it('treats every interrupting decision as notable', () => {
    for (const d of ['deny', 'block', 'ask', 'stop']) {
      expect(hookTone(run(d))).toBe('notable')
    }
  })

  // The emitter types `decision` as a bare string because a bridge may extend
  // the vocabulary. An unknown value is a real decision this build has no word
  // for, and hiding it would defeat the point of the row.
  it('treats a decision it does not recognize as notable', () => {
    expect(hookTone(run('escalate'))).toBe('notable')
  })

  it('has nothing to be loud about before a decision exists', () => {
    expect(hookTone(run())).toBe('quiet')
  })
})

describe('hookStderr', () => {
  const withStderr = (stderrSummary?: string): HookEntry => ({
    kind: 'hook',
    handlerId: 'h',
    point: 'Stop',
    dialect: 'codex',
    turn: 1,
    status: 'done',
    decision: 'pass',
    ...(stderrSummary !== undefined ? { stderrSummary } : {}),
  })

  it('drops an absent or blank summary so it cannot cost a row', () => {
    expect(hookStderr(withStderr())).toBeUndefined()
    expect(hookStderr(withStderr('   \n '))).toBeUndefined()
  })

  it('keeps real output, trimmed', () => {
    expect(hookStderr(withStderr('  refusing: dirty tree\n'))).toBe('refusing: dirty tree')
  })

  // The height the scroll math charges has to match what the row draws, or
  // paging stops being invertible.
  it('costs one row without stderr and more with it', () => {
    expect(estimateEntryRows(withStderr(), 80)).toBe(2)
    expect(estimateEntryRows(withStderr('x'.repeat(200)), 80)).toBeGreaterThan(2)
  })
})

describe('the renderable filter', () => {
  it('lets both halves of the pair through', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    invoke(session, 'h1')
    settle(session, 'h1', 'pass')
    const types = session.events.filter(isRenderable).map(e => e.type)
    expect(types).toContain('hook/invoked')
    expect(types).toContain('hook/result')
  })
})
