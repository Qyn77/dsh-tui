/**
 * How a Code Mode sub-call looks on screen.
 *
 * The projection is pinned in `code-dispatch.spec.ts`; what this file asks is
 * whether the composed frame still reads as *one* tool call with a program
 * inside it. Two things can only be seen here: that the sub-call rows sit under
 * the `run_code` row without a blank row prising them apart, and that a program
 * with many dispatches does not push the frame past the height Ink erases.
 * @module @deepseek-ai/dsh-tui/tests/code-dispatch-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

type Painted = Awaited<ReturnType<typeof paintApp>>

const PARENT = 'call-1'

async function program(
  painted: Painted,
  calls: readonly { name: string; path: string; isError?: boolean; text?: string }[],
): Promise<void> {
  await painted.append('tool/call', {
    callId: PARENT,
    name: 'run_code',
    arguments: '{"code":"await read()"}',
    turn: 1,
    step: 1,
  })
  for (const [index, call] of calls.entries()) {
    const subCallId = `${PARENT}:code:${String(index + 1)}`
    const shared = {
      rootCallId: PARENT,
      parentCallId: PARENT,
      subCallId,
      name: call.name,
      arguments: { file_path: call.path },
    }
    await painted.append('tool/code-dispatch-start', shared)
    await painted.append('tool/code-dispatch', {
      ...shared,
      isError: call.isError ?? false,
      content: [{ type: 'text', text: call.text ?? 'ok' }],
    })
  }
}

describe('a run_code program in the transcript', () => {
  it('names every tool the program called, under the call that ran it', async () => {
    const painted = await paintApp({ rows: 40 })
    await program(painted, [
      { name: 'Read', path: 'src/render/scroll.ts' },
      { name: 'Grep', path: 'src/core/state.ts' },
    ])
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('run_code')
    expect(screen).toContain('Read(src/render/scroll.ts)')
    expect(screen).toContain('Grep(src/core/state.ts)')
  })

  it('keeps the sub-calls welded to their parent, with no blank row between', async () => {
    const painted = await paintApp({ rows: 40 })
    await program(painted, [{ name: 'Read', path: 'src/render/scroll.ts' }])
    const lines = painted.screen().split('\n')
    painted.unmount()

    const parent = lines.findIndex(line => line.includes('run_code'))
    expect(parent).toBeGreaterThan(-1)
    // The very next row, not one after a separating margin — a sub-call is
    // part of the entry, not an entry of its own.
    expect(lines[parent + 1]).toContain('Read(src/render/scroll.ts)')
  })

  it('spends one row on a sub-call however much it printed', async () => {
    const painted = await paintApp({ rows: 40 })
    await program(painted, [
      { name: 'Read', path: 'src/render/scroll.ts', text: 'line\n'.repeat(200) },
    ])
    const lines = painted.screen().split('\n')
    painted.unmount()

    const parent = lines.findIndex(line => line.includes('run_code'))
    expect(lines[parent + 1]).toContain('Read(src/render/scroll.ts)')
    // Nothing of the output leaked onto a row of its own.
    expect(lines[parent + 2]).not.toContain('line')
  })

  it('shows why a sub-call failed, since that text is nowhere else', async () => {
    const painted = await paintApp({ rows: 40 })
    await program(painted, [
      { name: 'Read', path: 'nope.ts', isError: true, text: 'ENOENT: no such file' },
    ])
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('ENOENT: no such file')
  })

  it('leaves the frame its own height when a program calls many tools', async () => {
    const rows = 24
    const painted = await paintApp({ rows })
    await program(painted, Array.from({ length: 30 }, (_, index) => ({
      name: 'Read',
      path: `src/file-${String(index)}.ts`,
    })))
    const lines = painted.screen().split('\n')
    painted.unmount()

    // The App's root box is `rows - 3` tall and Yoga overlaps rather than
    // scrolls an overflowing subtree, so a sub-call list that outgrew the
    // viewport would print two things on one line rather than clip.
    expect(lines.length).toBeLessThanOrEqual(rows)
  })
})
