/**
 * How a hook run looks in the transcript.
 *
 * The `hook/*` events are documented log-only — audit records, carrying no
 * `surfaceOp`, so nothing about them asks to be drawn. The judgement this file
 * pins is which of them is worth the user's attention: a hook that let the turn
 * proceed is incidental, and a hook that stopped something is the only
 * explanation on screen for why a tool call did not run.
 * @module @deepseek-ai/dsh-tui/tests/hook-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

type Painted = Awaited<ReturnType<typeof paintApp>>

async function run(
  painted: Painted,
  decision: string,
  extra: { point?: string; stderrSummary?: string } = {},
): Promise<void> {
  const point = extra.point ?? 'PreToolUse'
  await painted.append('hook/invoked', {
    turn: 1,
    point,
    dialect: 'claude-code',
    handlerId: 'h1',
    matcher: 'Bash',
  })
  await painted.append('hook/result', {
    turn: 1,
    point,
    handlerId: 'h1',
    decision,
    durationMs: 42,
    ...(extra.stderrSummary !== undefined ? { stderrSummary: extra.stderrSummary } : {}),
  })
}

describe('a hook run in the transcript', () => {
  it('names the point and the decision in the emitter own words', async () => {
    const painted = await paintApp({ rows: 40 })
    await run(painted, 'deny')
    const screen = painted.screen()
    painted.unmount()

    // Untranslated on purpose: both are what the user's own hook config says.
    expect(screen).toContain('PreToolUse')
    expect(screen).toContain('deny')
  })

  it('says which bridge ran it', async () => {
    const painted = await paintApp({ rows: 40 })
    await run(painted, 'pass')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('claude-code')
  })

  it('reports how long it took', async () => {
    const painted = await paintApp({ rows: 40 })
    await run(painted, 'pass')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('42ms')
  })

  // The whole reason the feature exists: without this row the user is looking
  // at a tool call that never ran, with nothing on screen saying why.
  it('shows what a blocking hook printed', async () => {
    const painted = await paintApp({ rows: 40 })
    await run(painted, 'deny', { stderrSummary: 'refusing: working tree is dirty' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('refusing: working tree is dirty')
  })

  it('draws nothing at all in an assembly with no bridge', async () => {
    const painted = await paintApp({ rows: 40 })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('hook')
  })
})

// The weight a run is drawn at — dim grey for a decision that changed nothing,
// yellow for one that stopped something — is not asserted here, and that is a
// limitation of the harness rather than a gap. chalk's colour level is 0 under
// vitest, so no frame in this suite carries an SGR sequence to read; the same
// note opens `theme-frame.spec.ts`. The judgement the colour expresses is pure
// and is pinned as such by `hookTone` in `hook-runs.spec.ts`, including the
// case that matters most: a decision this build does not recognize is loud
// rather than quiet.

describe('a hook run whose result never arrives', () => {
  it('stops claiming to be running once the turn is over', async () => {
    const painted = await paintApp({ rows: 40 })
    await painted.append('turn/start', { turn: 1 })
    await painted.append('hook/invoked', {
      turn: 1,
      point: 'Stop',
      dialect: 'codex',
      handlerId: 'orphan',
    })
    await painted.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const screen = painted.screen()
    painted.unmount()

    // No decision is claimed for a verdict that was never recorded — in
    // particular not `pass`, which is what borrowing the tool path's
    // "completed turn ⇒ ok" rule would have printed.
    expect(screen).not.toContain('pass')
    expect(screen).toContain('Stop')
  })
})
