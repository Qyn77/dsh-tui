import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { lineDelta, taskOverview } from '../src/render/task-overview.ts'

it('counts actual line insertions/deletions and reports oversized or missing before-images as unknown', () => {
  expect(lineDelta('a\nb\nc\n', 'a\nB\nc\n')).toEqual({ added: 1, removed: 1 })
  expect(lineDelta('', 'a\n')).toEqual({ added: 1, removed: 0 })
  expect(lineDelta(null, 'a')).toBeUndefined()
  expect(lineDelta('x\n'.repeat(1100), 'y\n'.repeat(1100))).toBeUndefined()
})
it('aggregates sequential edits and records nested command outcomes without counting the parent twice', () => {
  const entry = { kind: 'tool' as const, callId: ToolCallId('a'), name: 'run_code', args: '{}', turn: 1, step: 1, status: 'ok' as const,
    subCalls: [
      { subCallId: ToolCallId('b'), name: 'edit', args: '{}', status: 'ok' as const, meta: { diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }] } },
      { subCallId: ToolCallId('c'), name: 'shell', args: '{"command":"pnpm test"}', status: 'error' as const },
    ] }
  const edit = { ...entry, subCalls: [], resultMeta: { diffs: [{ path: 'a.ts', oldText: 'b', newText: 'c\nd' }] } }
  const overview = taskOverview([entry, edit], 10)
  expect(overview.files).toEqual([{ path: 'a.ts', edits: 2, added: 2, removed: 1 }])
  expect(overview.commands).toEqual([{ command: 'pnpm test', outcome: 'error', entry: 11 }])
})
it('does not pretend that discontinuous edits establish a known net change', () => {
  const edit = (oldText: string, newText: string) => ({ kind: 'tool' as const, callId: ToolCallId(oldText), name: 'edit', args: '{}', turn: 1, step: 1,
    status: 'ok' as const, resultMeta: { diffs: [{ path: 'a', oldText, newText }] } })
  expect(taskOverview([edit('a', 'b'), edit('external change', 'd')]).files).toEqual([{ path: 'a', edits: 2 }])
})

it('adds a compact recorded overview to completed task disclosure', async () => {
  const { paintApp } = await import('./fake-tty.ts')
  const tty = await paintApp({ rows: 40, columns: 120 })
  try {
    await tty.append('turn/start', { turn: 1 })
    await tty.append('tool/call', { callId: 'call', name: 'run_code', arguments: '{}', turn: 1, step: 1 })
    const shared = { rootCallId: 'call', parentCallId: 'call', subCallId: 'nested', name: 'edit', arguments: { command: 'node --version' } }
    await tty.append('tool/ptc-dispatch-start', shared)
    await tty.append('tool/ptc-dispatch', { ...shared, isError: false, content: [{ type: 'text', text: 'ok' }],
      meta: { diffs: [{ path: 'fixture.txt', oldText: 'before', newText: 'after' }] } })
    await tty.finalize('done', { turn: 1, step: 1 })
    await tty.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(tty.screen()).toContain('1 files · 1 commands')
    expect(tty.screen()).toContain('/changes 1')
    await tty.send('/changes 1'); await tty.send('\r')
    expect(tty.screen()).toContain('fixture.txt · +1 −1')
    expect(tty.screen()).toContain('[ok] node --version')
  } finally { tty.unmount() }
})
