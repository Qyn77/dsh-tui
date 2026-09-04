/**
 * `useSessionEvents` — the projection's live wiring. Everything the user sees
 * arrives through this hook, and until now nothing tested it: the reducer had
 * `state.spec.ts`, the frames had the fake TTY, and the code that connects
 * them had neither.
 *
 * These tests drive the hook directly instead of asserting on frames. Its
 * contract is a `UiState` and two callbacks, not pixels, and the things most
 * likely to break — a subscription that survives unmount, a session-id guard
 * that lets another agent's events leak in, a `/clear` that resets more than
 * the entries — are all invisible in a screenshot.
 *
 * A real `Context` and a real `Session` are used throughout; only the `Agent`
 * is a double, because the hook touches exactly two of its members.
 * @module @deepseek-ai/dsh-tui/tests/session-events.spec
 */

import { describe, expect, it } from 'vitest'
import React from 'react'
import { render, Text } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { UiEntry, UiState } from '../src/types.ts'
import { useSessionEvents } from '../src/hooks/useSessionEvents.ts'
import { fakeStdout, seedSession } from './fake-tty.ts'

/** The hook's return value, captured out of the render. */
interface Api {
  state: UiState
  resetView: () => void
  appendEntry: (entry: UiEntry) => void
}

/** A mounted probe over the hook. */
interface Probe {
  /** The latest value the hook returned. */
  api: () => Api
  /** Emit a `session/event` the way the session plugin does, then settle. */
  emit: (session: Session, event: SessionEvent) => Promise<void>
  /** Run something that dispatches, then settle. */
  act: (fn: () => void) => Promise<void>
  /** Swap in a different agent — the resume path. */
  swap: (session: Session) => Promise<void>
  /**
   * How many times the subscription handler has looked at the agent. The
   * handler reads `agentRef.current.session` on every event, so a delta
   * across an emit says the listener ran — which is the only way to observe
   * a subscription that outlived its component.
   */
  handlerReads: () => number
  unmount: () => void
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20) })

/** The last event appended to a session — what the plugin would emit. */
function lastEvent(session: Session): SessionEvent {
  const event = session.events.at(-1)
  if (event === undefined) throw new Error('session has no events')
  return event
}

async function mount(session: Session): Promise<Probe> {
  const ctx = new Context()
  let captured: Api | undefined
  // Counting reads of `agent.session` is how the tests see the handler run.
  // Wrapping `ctx.on` to watch for its disposer would be more direct, but a
  // Cordis `Context` is a Proxy and the assignment does not stick.
  let reads = 0
  const agentFor = (s: Session): unknown => ({
    id: s.id,
    get session() {
      reads += 1
      return s
    },
  })

  const Probe: React.FC<{ session: Session }> = ({ session: current }) => {
    captured = useSessionEvents(ctx, agentFor(current) as never)
    return React.createElement(Text, null, 'probe')
  }

  const element = (s: Session): React.ReactElement =>
    React.createElement(Probe, { session: s })
  const instance = render(element(session), {
    stdout: fakeStdout(80, 10) as never,
    patchConsole: false,
    debug: true,
  })
  await settle()

  return {
    api: () => {
      if (captured === undefined) throw new Error('hook never ran')
      return captured
    },
    async emit(target, event) {
      ctx.emit('session/event', target, event)
      await settle()
    },
    async act(fn) {
      fn()
      await settle()
    },
    async swap(next) {
      instance.rerender(element(next))
      await settle()
    },
    handlerReads: () => reads,
    unmount: () => { instance.unmount() },
  }
}

describe('seeding from the durable log', () => {
  it('replays an existing session so resumed work is on screen', async () => {
    const probe = await mount(seedSession(2))
    const { state } = probe.api()
    probe.unmount()

    // A user entry carries the whole `UserMessage`, not a flat string, so the
    // assistant's text is what a shallow assertion can name.
    const assistant = state.entries.filter(e => e.kind === 'assistant')
    expect(assistant.map(e => e.text)).toEqual(['answer 01', 'answer 02'])
    expect(state.entries.filter(e => e.kind === 'user')).toHaveLength(2)
    expect(state.currentTurn).toBe(2)
    expect(state.status).toBe('idle')
  })

  it('starts empty for a session with no events', async () => {
    const probe = await mount(Session.create('tui-seed' as never))
    const { state } = probe.api()
    probe.unmount()

    expect(state.entries).toEqual([])
  })

  it('skips events the projection has no rendering for', async () => {
    const session = Session.create('tui-seed' as never)
    session.append('todo/write', { todos: [{ content: 'x', status: 'pending' }] })
    const probe = await mount(session)
    const { state } = probe.api()
    probe.unmount()

    // `todo/write` is log-only. Seeding must not invent an entry for it.
    //
    // This pins the pair, not the `isRenderable` call: `reduce` returns its
    // input unchanged for an event it has no case for, so deleting the guard
    // leaves this green. It is still worth having — the day someone adds a
    // `todo/write` case to the reducer, the guard is what stops it reaching
    // the view, and this is the test that notices the guard went missing.
    expect(state.entries).toEqual([])
  })

  it('re-seeds from the new log when the agent changes session', async () => {
    // The `/resume` path. The subscription already followed the swap before
    // this existed; the projection did not, so the resumed session's events
    // arrived on top of the previous session's transcript.
    const first = seedSession(2, 'tui-first')
    const second = seedSession(5, 'tui-second')
    const probe = await mount(first)
    expect(probe.api().state.entries.filter(e => e.kind === 'assistant')).toHaveLength(2)

    await probe.swap(second)
    const state = probe.api().state
    probe.unmount()

    const assistant = state.entries.filter(e => e.kind === 'assistant')
    expect(assistant.map(e => e.text)).toEqual([
      'answer 01', 'answer 02', 'answer 03', 'answer 04', 'answer 05',
    ])
    expect(state.currentTurn).toBe(5)
  })

  it('empties the view when the resumed session has no events', async () => {
    // Nothing carried over is the whole point: the banner renders only on an
    // empty log, so a leftover entry would suppress it on a fresh session.
    const probe = await mount(seedSession(2, 'tui-first'))
    await probe.swap(Session.create('tui-empty' as never))
    const state = probe.api().state
    probe.unmount()

    expect(state.entries).toEqual([])
    expect(state.currentTurn).toBe(0)
  })

  it('keeps a local entry appended after the swap', async () => {
    // `/resume` reports itself by appending a command entry once the swap
    // resolves. Re-seeding on the same tick must not swallow it — a switch
    // that says nothing looks like a command that did nothing.
    const probe = await mount(seedSession(1, 'tui-first'))
    await probe.swap(seedSession(3, 'tui-second'))
    await probe.act(() => {
      probe.api().appendEntry({ kind: 'command', input: '/resume tui-x', text: 'Resumed.', failed: false })
    })
    const state = probe.api().state
    probe.unmount()

    expect(state.entries.at(-1)).toMatchObject({ kind: 'command', text: 'Resumed.' })
    expect(state.entries.filter(e => e.kind === 'assistant')).toHaveLength(3)
  })
})

describe('the live subscription', () => {
  it('projects an event as it arrives', async () => {
    const session = seedSession(1)
    const probe = await mount(session)
    expect(probe.api().state.currentTurn).toBe(1)

    session.append('turn/start', { turn: 2 })
    await probe.emit(session, lastEvent(session))
    const running = probe.api().state
    probe.unmount()

    expect(running.currentTurn).toBe(2)
    expect(running.status).toBe('running')
  })

  it('ignores an event belonging to another session', async () => {
    // Two agents can share one Context. Without the id guard, a background
    // agent's turn would appear in this one's conversation.
    //
    // The ids have to be made distinct by hand: `Session.create` takes the id
    // as its argument, so every `seedSession` shares one — which means a test
    // built from two of them would exercise the guard's *pass* path and prove
    // the opposite of what it claims.
    const mine = Session.create('tui-mine' as never)
    const theirs = Session.create('tui-theirs' as never)
    const probe = await mount(mine)
    const before = probe.api().state

    theirs.append('turn/start', { turn: 9 })
    await probe.emit(theirs, lastEvent(theirs))
    const after = probe.api().state
    probe.unmount()

    expect(after).toBe(before)
  })

  it('ignores a live event the projection has no rendering for', async () => {
    // Same caveat as the seeding case above: `reduce` already returns its
    // input for an unknown event, so this holds with or without the guard.
    const session = seedSession(1)
    const probe = await mount(session)
    const before = probe.api().state

    session.append('todo/write', { todos: [] })
    await probe.emit(session, lastEvent(session))
    const after = probe.api().state
    probe.unmount()

    expect(after).toBe(before)
  })

  it('disposes the subscription on unmount', async () => {
    // A live subscription over an unmounted tree keeps projecting into
    // nothing, and holds the Context reference that would let it be freed.
    const session = seedSession(1)
    const probe = await mount(session)

    session.append('turn/start', { turn: 2 })
    const beforeEmit = probe.handlerReads()
    await probe.emit(session, lastEvent(session))
    const whileMounted = probe.handlerReads()

    probe.unmount()
    // Ink's `unmount` does not run effect cleanups synchronously — React
    // commits the teardown on a later tick. Emitting before that lands would
    // catch a subscription that *is* about to be disposed and call it a leak.
    await settle()
    // Sampled after the teardown has landed: it renders once more on the way
    // out and that render reads the agent too, so only the delta across the
    // emit that follows belongs to the subscription.
    const settled = probe.handlerReads()
    await probe.emit(session, lastEvent(session))
    const afterUnmount = probe.handlerReads()

    // Mounted, the handler looked at the agent; unmounted, it did not run.
    expect(whileMounted).toBeGreaterThan(beforeEmit)
    expect(afterUnmount).toBe(settled)
  })

  it('follows the agent onto a different session', async () => {
    // The resume path: same Context, new session. The old subscription has to
    // go and the new id has to be the one the guard compares against.
    const first = seedSession(1, 'tui-first')
    const second = seedSession(3, 'tui-second')
    const probe = await mount(first)
    await probe.swap(second)

    second.append('turn/start', { turn: 4 })
    await probe.emit(second, lastEvent(second))
    const after = probe.api().state
    probe.unmount()

    expect(after.currentTurn).toBe(4)
  })
})

describe('the two local view operations', () => {
  it('clears the entries without forgetting where the session is', async () => {
    // `/clear` is a view operation. Resetting the turn counter or the status
    // would make the StatusBar lie about a turn that is still running.
    const session = seedSession(2)
    const probe = await mount(session)
    await probe.act(() => { probe.api().resetView() })
    const state = probe.api().state
    probe.unmount()

    expect(state.entries).toEqual([])
    expect(state.currentTurn).toBe(2)
    expect(state.status).toBe('idle')
  })

  it('appends a local entry without writing to the durable log', async () => {
    // Slash command output is ours, not the model's. If it reached the
    // session it would be replayed as context on the next request.
    const session = seedSession(1)
    const probe = await mount(session)
    const logged = session.events.length

    await probe.act(() => {
      probe.api().appendEntry({ kind: 'command', input: '/help', text: 'output', failed: false })
    })
    const state = probe.api().state
    probe.unmount()

    expect(state.entries.at(-1)).toEqual({
      kind: 'command',
      input: '/help',
      text: 'output',
      failed: false,
    })
    expect(session.events).toHaveLength(logged)
  })

  it('keeps the two callbacks stable across renders', async () => {
    // `renderer.tsx` lists them in a `useCallback` dependency array; a new
    // identity on every render would rebuild the submit handler each frame.
    const session = seedSession(1)
    const probe = await mount(session)
    const before = probe.api()

    session.append('turn/start', { turn: 2 })
    await probe.emit(session, lastEvent(session))
    const after = probe.api()
    probe.unmount()

    expect(after.resetView).toBe(before.resetView)
    expect(after.appendEntry).toBe(before.appendEntry)
  })
})
