/**
 * How an approval question looks in the *transcript*.
 *
 * The live card is `approval-frame.spec.ts`'s subject; this file is about the
 * rows that outlive it. The projection is pinned in `approval.spec.ts`; what
 * only the composed frame can answer is whether the audit trail reads as an
 * audit trail rather than a warning banner — that a reason sits under the row
 * that quotes it, and that a question the turn ended on says "no decision"
 * instead of hanging on screen forever.
 * @module @deepseek-ai/dsh-tui/tests/approval-audit-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

type Painted = Awaited<ReturnType<typeof paintApp>>

const ID = 'ask-1'

async function ask(
  painted: Painted,
  over: { id?: string; toolName?: string; reason?: string } = {},
): Promise<void> {
  await painted.append('approval/asked', {
    id: over.id ?? ID,
    toolName: over.toolName ?? 'shell',
    ...(over.reason !== undefined ? { reason: over.reason } : {}),
  })
}

describe('an approval question in the transcript', () => {
  it('names the tool and the decision on one row', async () => {
    const painted = await paintApp({ rows: 40 })
    await ask(painted, { toolName: 'shell' })
    await painted.append('approval/decided', { id: ID, outcome: 'rejected' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('shell')
    expect(screen).toContain('rejected')
  })

  it('prints the asker\'s reason under the row that quotes it', async () => {
    const painted = await paintApp({ rows: 40 })
    await ask(painted, { toolName: 'write', reason: 'writes outside the workspace' })
    const lines = painted.screen().split('\n')
    painted.unmount()

    const header = lines.findIndex(line => line.includes('write'))
    expect(header).toBeGreaterThanOrEqual(0)
    // The very next line, no blank row: the reason belongs to this question,
    // and a gap makes it read as a separate remark from the assistant.
    expect(lines[header + 1]).toContain('writes outside the workspace')
  })

  it('prints an outcome word this build has never heard of', async () => {
    // The vocabulary is the service's to extend. A row that only knew four
    // words would drop the fifth silently, which is the one case where the
    // user most needs to see what happened.
    const painted = await paintApp({ rows: 40 })
    await ask(painted)
    await painted.append('approval/decided', { id: ID, outcome: 'escalated' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('escalated')
  })

  it('says a question the turn ended on got no decision', async () => {
    const painted = await paintApp({ rows: 40 })
    await ask(painted, { toolName: 'shell' })
    await painted.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toMatch(/no decision|没有决定/)
    expect(screen).not.toContain('waiting')
  })

  it('draws a policy switch as its own row, delegation marked', async () => {
    const painted = await paintApp({ rows: 40 })
    await painted.append('approval/policy', { policy: 'never', source: 'delegation' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('never')
    expect(screen).toMatch(/delegated|受委托/)
  })
})
