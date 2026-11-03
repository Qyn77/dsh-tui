import { expect, it } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { recoveryPlan } from '../src/commands/recovery.ts'
import type { UiState } from '../src/core/types.ts'
import { paintApp } from './fake-tty.ts'

it('retains completed-tool audit while preparing a continuation', () => {
  const state: UiState = { status: 'idle', currentTurn: 1, lastReason: { kind: 'interrupted' }, entries: [
    { kind: 'user', message: createUserMessage({ content: [{ type: 'text', text: 'request' }], source: { kind: 'user' } }) },
    { kind: 'tool', callId: ToolCallId('a'), name: 'edit', args: '{}', turn: 1, step: 1, status: 'ok' },
  ] }
  expect(recoveryPlan(state)).toEqual({ text: 'request', completed: ['edit'], reason: 'interrupted' })
  expect(recoveryPlan({ ...state, status: 'running' })).toBeUndefined()
  expect(recoveryPlan({ ...state, lastReason: { kind: 'completed' } })).toBeUndefined()
})
it('restores a submission that fails before the agent accepts it', async () => {
  const tty = await paintApp({ followup: () => { throw new Error('offline') } })
  try {
    await tty.send('keep this draft')
    await tty.send('\r')
    await tty.settle(50)
    expect(tty.screen()).toContain('offline')
    expect(tty.screen()).toContain('> keep this draft')
  } finally { tty.unmount() }
})
