/**
 * Reducer behavior: session events become the projected UI state. The reducer
 * is pure; the tests append real events to a real `Session` and replay them.
 */

import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import { initialState, reduce, replay } from '../src/state.ts'

function makeSession(): Session {
  return Session.create('tui-test' as never)
}

function appendTurn(session: Session, turn: number, completed: boolean): void {
  const user = createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'user' },
  })
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', user, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { provider: 'p', model: 'm' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', {
    turn,
    reason: completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  })
}

describe('tui state reducer', () => {
  it('starts empty and idle', () => {
    expect(initialState()).toEqual({ entries: [], status: 'idle', currentTurn: 0 })
  })

  it('appends a user message and finalizes a turn with assistant text', () => {
    const session = makeSession()
    appendTurn(session, 1, true)
    const state = replay(session.events)
    expect(state.status).toBe('idle')
    expect(state.entries).toHaveLength(2)
    expect(state.entries[0]).toMatchObject({ kind: 'user' })
    const assistant = state.entries[1] as Extract<(typeof state.entries)[number], { kind: 'assistant' }>
    expect(assistant.text).toBe('hello')
    expect(assistant.finalized).toBe(true)
  })

  it('accumulates text-delta chunks into one assistant entry, then finalizes via assistant/message', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'q' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    for (const text of ['Hel', 'lo, ', 'world']) {
      session.append('assistant/chunk', {
        turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text },
      })
    }
    session.append('assistant/message', {
      turn: 1, step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Hello, world' }],
        source: { provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    const state = replay(session.events)
    const assistants = state.entries.filter(e => e.kind === 'assistant')
    expect(assistants).toHaveLength(1)
    const a = assistants[0] as Extract<(typeof assistants)[number], { kind: 'assistant' }>
    expect(a.text).toBe('Hello, world')
    expect(a.finalized).toBe(true)
  })

  it('records a tool call and resolves it with the next result, using the running tail', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/call', {
      callId: 'c1' as never, name: 'bash', arguments: 'ls', turn: 1, step: 1,
    })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c1' as never, content: [{ type: 'text', text: 'a.txt' }], isError: false,
      }),
    }, { surfaceOp: 'append' })
    const state = replay(session.events)
    const tools = state.entries.filter(e => e.kind === 'tool')
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ kind: 'tool', status: 'ok', name: 'bash' })
  })

  it('flags a tool entry as error when the result carries an error envelope', () => {
    const session = makeSession()
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('tool/call', {
      callId: 'c1' as never, name: 'bash', arguments: 'false', turn: 1, step: 1,
    })
    session.append('tool/result', {
      turn: 1, step: 1,
      message: createToolResultMessage({
        callId: 'c1' as never, content: [{ type: 'text', text: 'failed' }], isError: true,
      }),
      error: { name: 'BashError', code: 'EXIT_NONZERO' },
    }, { surfaceOp: 'append' })
    const state = replay(session.events)
    expect((state.entries[0] as Extract<(typeof state.entries)[number], { kind: 'tool' }>).status).toBe('error')
  })

  it('appends a turn-ended note for non-completed reasons', () => {
    const session = makeSession()
    appendTurn(session, 1, false)
    const state = replay(session.events)
    const note = state.entries.find(e => e.kind === 'note')
    expect(note).toBeDefined()
    expect((note as Extract<(typeof state.entries)[number], { kind: 'note' }>).text).toMatch(/aborted/)
  })

  it('handles session/end-seed by wiping the projected view above the seed', () => {
    // Build a session log where some events come before `session/end-seed`
    // (resumed history) and some after (live work). The reducer must drop
    // everything before the seed boundary.
    const events = [
      { type: 'user/message' as const, seq: 0, time: 0, data: createUserMessage({ content: [{ type: 'text', text: 'old' }], source: { kind: 'user' } }), surfaceOp: 'append' as const },
      { type: 'session/end-seed' as const, seq: 1, time: 0, data: {} },
      { type: 'user/message' as const, seq: 2, time: 0, data: createUserMessage({ content: [{ type: 'text', text: 'new' }], source: { kind: 'user' } }), surfaceOp: 'append' as const },
    ]
    const state = replay(events as never)
    // Only the post-seed "new" message survives.
    expect(state.entries).toHaveLength(1)
    expect((state.entries[0] as Extract<(typeof state.entries)[number], { kind: 'user' }>).message.content[0]).toMatchObject({ type: 'text', text: 'new' })
  })

  it('ignores inbox/spliced events instead of throwing', () => {
    const session = makeSession()
    session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [],
    })
    expect(() => reduce(initialState(), session.events.find(e => e.type === 'agent/inbox/spliced')!)).not.toThrow()
  })

  it('tracks a compaction lifecycle in one entry, advancing through summary and end', () => {
    // Compaction events are merged into the SessionEventMap by
    // `@deepseek-ai/dsh-compaction`; the reducer's declaration merging
    // pulls them in here. We build the events directly so the test does
    // not depend on that plugin's load.
    const events = [
      { type: 'compaction/start' as const, seq: 0, time: 0, data: { trigger: 'auto' as const } },
      { type: 'compaction/summary' as const, seq: 1, time: 0, data: { tokensBefore: 100, tokensAfter: 40 } },
      { type: 'compaction/end' as const, seq: 2, time: 0, data: { ok: true } },
    ] as never
    const state = replay(events)
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ kind: 'compaction', stage: 'end' })
  })
})
