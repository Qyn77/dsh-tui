import { expect, it } from 'vitest'
import type { UiState } from '../src/core/types.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { activityView } from '../src/render/activity.ts'

const state: UiState = {
  status: 'idle', currentTurn: 1,
  entries: [
    { kind: 'user', message: createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }) },
    { kind: 'assistant', turn: 1, step: 1, text: 'checking', finalized: true },
    { kind: 'assistant', turn: 1, step: 2, text: 'result', finalized: true },
  ],
  tasks: [{ turn: 1, startIndex: 0, endIndex: 3, startedAt: 1000, endedAt: 56000, outcome: 'completed' }],
}

it('collapses completed intermediate activity and keeps the user and final answer', () => {
  const view = activityView(state, new Set())
  expect(view.entries.map(entry => entry.kind)).toEqual(['user', 'activity', 'assistant'])
  expect(view.entries[1]).toMatchObject({ durationMs: 55000, count: 1, expanded: false })
  expect(view.entries[2]).toMatchObject({ text: 'result' })
  expect(state.entries).toHaveLength(3)
})
it('expands one task independently and keeps its disclosure', () => {
  expect(activityView(state, new Set([1])).entries.map(entry => entry.kind)).toEqual(['user', 'activity', 'assistant', 'assistant'])
})
it('never collapses a still-running task', () => {
  expect(activityView({ ...state, tasks: [{ ...state.tasks![0], endedAt: undefined, endIndex: undefined }] }, new Set()).entries).toEqual(state.entries)
})
it('keeps failure notes visible outside the collapsed activity', () => {
  const failed: UiState = { ...state, entries: [...state.entries, { kind: 'note', text: 'failed', tone: 'error' }],
    tasks: [{ ...state.tasks![0], endIndex: 4, outcome: 'error' }] }
  expect(activityView(failed, new Set()).entries.at(-1)).toMatchObject({ kind: 'note', tone: 'error' })
})

it('reconstructs task duration from recorded events after replay', async () => {
  const { seedSession } = await import('./fake-tty.ts')
  const { recordedEvents } = await import('./recorded-session.ts')
  const { replay } = await import('../src/core/state.ts')
  const events = recordedEvents(seedSession(1)).map((event, index) => ({ ...event, time: 1000 + index * 1000 }))
  const replayed = replay(events)
  const task = replayed.tasks?.[0]
  expect(task?.endIndex).toBe(replayed.entries.length)
  expect(task?.endedAt! - task?.startedAt!).toBe(5000)
})

it('renders a collapsed group and expands it through the live prompt', async () => {
  const { paintApp } = await import('./fake-tty.ts')
  const tty = await paintApp({ rows: 50 })
  try {
    await tty.append('turn/start', { turn: 1 })
    await tty.finalize('checking', { turn: 1, step: 1 })
    await tty.finalize('final result', { turn: 1, step: 2 })
    await tty.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(tty.screen()).toContain('worked for')
    expect(tty.screen()).toContain('final result')
    expect(tty.screen()).not.toContain('checking')
    await tty.send('/activity 1')
    await tty.send('\r')
    expect(tty.screen()).toContain('checking')
  } finally { tty.unmount() }
})

it('retains emitted reasoning for disclosure without showing it beside the collapsed answer', () => {
  const withReasoning: UiState = { ...state, entries: [state.entries[0], {
    kind: 'assistant', turn: 1, step: 1, text: 'answer', reasoning: 'recorded reasoning', finalized: true,
  }], tasks: [{ ...state.tasks![0], endIndex: 2 }] }
  expect(activityView(withReasoning, new Set()).entries.at(-1)).toMatchObject({ reasoning: 'recorded reasoning', reasoningVisible: false })
  expect(activityView(withReasoning, new Set([1])).entries.at(-1)).toMatchObject({ reasoningVisible: true })
})

it('keeps a tool-only final result visible rather than hiding every outcome', () => {
  const tool = { kind: 'tool' as const, callId: 'last' as never, name: 'present', args: '{}', turn: 1, step: 1, status: 'ok' as const }
  const toolOnly: UiState = { ...state, entries: [state.entries[0], tool], tasks: [{ ...state.tasks![0], endIndex: 2 }] }
  expect(activityView(toolOnly, new Set()).entries.at(-1)).toBe(tool)
})
