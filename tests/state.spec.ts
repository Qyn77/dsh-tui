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
import { initialState, isRuntimeContext, reduce, replay } from '../src/state.ts'

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
    const a = assistants[0]
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

  describe('a tool still running when the turn ends', () => {
    /**
     * A turn that opens a tool call and then ends without any result. The
     * reason is passed loosely and cast at the `append` boundary: `TurnEndReason`
     * is a union owned by dsh-session and each arm is spelled out at the call
     * site, which is what these tests are varying.
     */
    function unfinishedTool(reason: Record<string, unknown>): ReturnType<typeof replay> {
      const session = makeSession()
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('tool/call', {
        callId: 'c1' as never, name: 'bash', arguments: 'sleep 100', turn: 1, step: 1,
      })
      session.append('turn/end', { turn: 1, reason } as never)
      return replay(session.events)
    }

    function toolStatus(state: ReturnType<typeof replay>): string {
      const tool = state.entries.find(e => e.kind === 'tool')
      return (tool as Extract<(typeof state.entries)[number], { kind: 'tool' }>).status
    }

    function note(state: ReturnType<typeof replay>) {
      return state.entries.find(e => e.kind === 'note')
    }

    it('is cancelled, not ok, when the user interrupts', () => {
      // The defect this whole case exists for: an unconditional `ok` here
      // told the user a tool they had just killed with Ctrl-C had completed.
      const state = unfinishedTool({ kind: 'interrupted' })
      expect(toolStatus(state)).toBe('cancelled')
      expect(note(state)?.tone).toBe('warn')
    })

    it('is cancelled when the turn is aborted', () => {
      const state = unfinishedTool({ kind: 'aborted', reason: { kind: 'user' } })
      expect(toolStatus(state)).toBe('cancelled')
      expect(note(state)?.tone).toBe('warn')
    })

    it('is an error, and the note is toned red, when the turn errored', () => {
      const state = unfinishedTool({ kind: 'error', error: { name: 'ModelError', code: 'ETIMEDOUT' } })
      expect(toolStatus(state)).toBe('error')
      expect(note(state)?.tone).toBe('error')
      expect(note(state)?.text).toMatch(/ETIMEDOUT/)
    })

    it('is ok on a clean completion, and leaves no note behind', () => {
      const state = unfinishedTool({ kind: 'completed' })
      expect(toolStatus(state)).toBe('ok')
      expect(note(state)).toBeUndefined()
    })

    it('says a blocked turn never ran, rather than printing the word "blocked"', () => {
      // `blocked` is a pre-step rejection: dsh-agent discards the messages the
      // turn had claimed, so the work will never run. The reducer used to fall
      // through to the generic arm and print `[turn 1 ended: blocked]`, which
      // is jargon from the event log rather than something a user can act on.
      const state = unfinishedTool({ kind: 'blocked' })
      expect(toolStatus(state)).toBe('cancelled')
      expect(note(state)?.tone).toBe('warn')
      expect(note(state)?.text).toMatch(/never ran|before it ran/)
    })

    it('says the reply was truncated when the turn hit the output limit', () => {
      // The one ending where output survives: the reply is real and merely cut
      // short. It must not be phrased like the endings that lose the work.
      const state = unfinishedTool({ kind: 'max-tokens' })
      expect(note(state)?.tone).toBe('warn')
      expect(note(state)?.text).toMatch(/truncated/)
    })

    it('prints the bare kind for an ending this build has never heard of', () => {
      // `TurnEndReasonMap` is merge-extensible, so a backend can log an ending
      // no case here names. `quota-exhausted` stands in for a variant a future
      // peer merges in, and the reducer must degrade to the raw `kind` instead
      // of dropping the turn's ending on the floor.
      //
      // No cast is needed to express that: `unfinishedTool` takes a
      // `Record<string, unknown>` precisely so an unknown reason can be written
      // literally, and the one widening the test does need lives inside it, on
      // the `turn/end` append.
      const state = unfinishedTool({ kind: 'quota-exhausted' })
      expect(toolStatus(state)).toBe('cancelled')
      expect(note(state)?.text).toContain('quota-exhausted')
    })
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
    const state = replay(events)
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

  it('routes plugin-injected user messages to runtime-context, not the user slot', () => {
    // Per dsh-session/README, the typed `source` is the only channel
    // that distinguishes a real human prompt from a synthetic plugin
    // injection. A real prompt keeps the `you` label; a plugin
    // injection (e.g. agent-instructions shipping a <system-reminder>)
    // is rendered as a runtime-context row.
    const session = makeSession()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'real human prompt' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '<system-reminder>workspace state…</system-reminder>' }],
      source: { kind: 'plugin', plugin: 'agent-instructions', form: 'instructions' },
    }), { surfaceOp: 'append' })
    const state = replay(session.events)
    expect(state.entries).toHaveLength(2)
    expect(state.entries[0]).toMatchObject({ kind: 'user' })
    expect(state.entries[1]).toMatchObject({
      kind: 'runtime-context',
      plugin: 'agent-instructions',
      form: 'instructions',
    })
    const rc = state.entries[1] as Extract<(typeof state.entries)[number], { kind: 'runtime-context' }>
    expect(rc.preview).toContain('system-reminder')
  })

  it('truncates the runtime-context preview at 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(200)
    const session = makeSession()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: long }],
      source: { kind: 'plugin', plugin: 'big-payload', form: 'catalog' },
    }), { surfaceOp: 'append' })
    const state = replay(session.events)
    const rc = state.entries[0] as Extract<(typeof state.entries)[number], { kind: 'runtime-context' }>
    // 80-char cap, ellipsized on overflow.
    expect(rc.preview.length).toBe(80)
    expect(rc.preview.endsWith('…')).toBe(true)
  })

  it('omits plugin and form when the source has no producer identity', () => {
    // A non-`user` source without a known plugin name (e.g. a future
    // source kind that does not carry `plugin`) still routes to
    // runtime-context, but the row carries no producer label.
    const session = makeSession()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'synthetic' }],
      source: { kind: 'plugin', plugin: 'mystery' },
    }), { surfaceOp: 'append' })
    const state = replay(session.events)
    const rc = state.entries[0] as Extract<(typeof state.entries)[number], { kind: 'runtime-context' }>
    expect(rc.plugin).toBe('mystery')
    expect(rc.form).toBeUndefined()
  })
})

describe('plan mode', () => {
  // `plan/mode` comes from `@deepseek-ai/dsh-plan-mode`, which this package
  // does not depend on: `src/types.ts` declares the payload locally so the TUI
  // compiles and renders in an assembly that never mounts it. That makes these
  // the only check that the projection matches the shape it declared — there is
  // no upstream type to catch a drift for us.
  it('projects a switch into the transcript, keeping the sequence number', () => {
    const session = makeSession()
    session.append('plan/mode', { enabled: true })
    const state = replay(session.events)

    // `at` carries the seq so the entry sorts with everything around it; a
    // constant would pile every switch at one position in the list.
    expect(state.entries).toEqual([
      { kind: 'plan', enabled: true, at: session.events[0]?.seq },
    ])
  })

  it('records leaving plan mode as its own entry, not as a removal', () => {
    // Both edges are part of the account: a transcript that showed only the
    // switch on would read as though everything after it was still read-only.
    const session = makeSession()
    session.append('plan/mode', { enabled: true })
    session.append('plan/mode', { enabled: false })
    const state = replay(session.events)

    expect(state.entries.map(e => e.kind === 'plan' && e.enabled)).toEqual([true, false])
  })

  it('leaves the turn counter and status alone', () => {
    // It is a note about how the agent is running, not a step of the
    // conversation. Touching `currentTurn` would make the StatusBar lie.
    const session = makeSession()
    appendTurn(session, 1, true)
    session.append('plan/mode', { enabled: true })
    const state = replay(session.events)

    expect(state.currentTurn).toBe(1)
    expect(state.status).toBe('idle')
  })
})

describe('isRuntimeContext', () => {
  it('returns false for a human-source user message', () => {
    const msg = createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    })
    expect(isRuntimeContext(msg)).toBe(false)
  })

  it('returns true for a plugin-source user message (any form)', () => {
    const msg = createUserMessage({
      content: [{ type: 'text', text: 'injected' }],
      source: { kind: 'plugin', plugin: 'p', form: 'instructions' },
    })
    expect(isRuntimeContext(msg)).toBe(true)
  })

  it('returns true for a tool-source user message (defensive)', () => {
    // `user/message` events normally carry only `user` or `plugin`
    // sources, but if a future event shape ever lands a `tool` source
    // here, it is not a human prompt either.
    const msg = createUserMessage({
      content: [{ type: 'text', text: 'tool result' }],
      source: { kind: 'tool', callId: 'c1' as never },
    })
    expect(isRuntimeContext(msg)).toBe(true)
  })
})
