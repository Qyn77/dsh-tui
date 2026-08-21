/**
 * The conversation viewport's *frame*, as opposed to its pure arithmetic
 * (that lives in `scroll.spec.ts`). These tests render the real `App`
 * against a fake TTY and read pixels, because every scroll bug this file
 * exists for was invisible to unit tests:
 *
 * - the window was sliced by **entry count** while the box clipped by
 *   **row**, top-anchored — so the clipped edge was the bottom and the
 *   newest messages could not be reached by any keystroke;
 * - Home/End were compared against an ESC-stripped string that Ink never
 *   delivers, so they were dead code that read as implemented;
 * - wheel reports are ordinary stdin data, so without a guard they were
 *   typed into the prompt buffer.
 *
 * Each of those is a property of the composed frame, not of a function.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { App } from '../src/renderer.tsx'

/** Built, never quoted: an invisible ESC byte in source is unreviewable. */
const ESC = String.fromCharCode(27)

interface FakeStdout extends EventEmitter {
  columns: number
  rows: number
  write: (chunk: string) => boolean
  frames: string[]
}

function fakeStdout(columns: number, rows: number): FakeStdout {
  const out = new EventEmitter() as FakeStdout
  out.columns = columns
  out.rows = rows
  out.frames = []
  out.write = (chunk: string) => {
    out.frames.push(chunk)
    return true
  }
  return out
}

/**
 * A stdin that claims to be a TTY *and* can be fed keystrokes the way Ink
 * actually consumes them: Ink 5 attaches a `readable` listener and drains
 * `stdin.read()` in a loop, so a fake that only emits `data` delivers
 * nothing at all. Queue the chunk, hand it out once from `read()`, then
 * report empty.
 */
function fakeTtyStdin(): NodeJS.ReadStream & { send: (data: string) => void } {
  const queue: string[] = []
  const stdin = new EventEmitter() as never as NodeJS.ReadStream & { send: (data: string) => void }
  return Object.assign(stdin, {
    isTTY: true,
    setEncoding: () => stdin,
    setRawMode: () => stdin,
    read: () => queue.shift() ?? null,
    ref: () => stdin,
    unref: () => stdin,
    resume: () => stdin,
    pause: () => stdin,
    send: (data: string) => {
      queue.push(data)
      ;(stdin as unknown as EventEmitter).emit('readable')
    },
  }) as never
}

const selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

/** Strip SGR/cursor escapes so assertions read the visible characters. */
// eslint-disable-next-line no-control-regex
const strip = (frame: string): string => frame.replace(/\[[0-9;?]*[A-Za-z]/g, '')

/**
 * Seed a session with `turns` question/answer pairs. Two entries per turn,
 * each labelled with its turn number so a frame assertion can name the
 * oldest and the newest row without counting rows. The numbers are
 * zero-padded because `answer 1` is a substring of `answer 10`, and an
 * assertion that passes on the wrong row is worse than no assertion.
 */
function seed(turns: number): Session {
  const session = Session.create('tui-scroll' as never)
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `question ${String(turn).padStart(2, '0')}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: `answer ${String(turn).padStart(2, '0')}` }],
        source: { provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return session
}

async function paint(turns: number, rows = 40, columns = 100): Promise<{
  screen: () => string
  send: (data: string) => Promise<void>
  unmount: () => void
}> {
  const stdout = fakeStdout(columns, rows)
  const stdin = fakeTtyStdin()
  const ctx = new Context()
  ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
  const session = seed(turns)
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    cancel: () => {}, followup: () => {}, steer: () => {}, inject: () => {},
    whenIdle: () => Promise.resolve(),
    on: () => () => {},
  }
  const instance = render(
    React.createElement(App, { ctx, agent: agent as never, exit: () => {} }),
    { stdout: stdout as never, stdin: stdin as never, patchConsole: false, exitOnCtrlC: false, debug: true },
  )
  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 30) })
  await settle()
  return {
    screen: () => strip(stdout.frames.at(-1) ?? ''),
    async send(data: string) {
      stdin.send(data)
      await settle()
    },
    unmount: () => { instance.unmount() },
  }
}

describe('message list viewport', () => {
  it('shows the newest entry when the log is taller than the terminal', async () => {
    // The reported bug, reproduced: 20 entries in a 40-row terminal used
    // to render from `entries[8]` downward and clip the *bottom*, so the
    // screen stopped around turn 4 and turns 5..10 were unreachable.
    const painted = await paint(10)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('answer 10')
    // ...and the oldest turn is the one that got clipped away, which is
    // what proves the anchor is the tail rather than the head.
    expect(screen).not.toContain('question 01')
  })

  it('reveals older rows on PageUp and returns on PageDown', async () => {
    const painted = await paint(10)
    await painted.send(`${ESC}[5~`)
    const scrolledUp = painted.screen()
    await painted.send(`${ESC}[6~`)
    const scrolledBack = painted.screen()
    painted.unmount()

    // Older content came into view, and the hint says so. One page is one
    // viewport, not the whole log, so name the range rather than the top.
    expect(scrolledUp).toMatch(/answer 0[1-8]/)
    expect(scrolledUp).not.toContain('answer 10')
    expect(scrolledUp).toMatch(/more rows? below/)
    // Coming back reaches the newest row again and drops the hint.
    expect(scrolledBack).toContain('answer 10')
    expect(scrolledBack).not.toMatch(/more rows? below/)
  })

  it('pins back to the newest row on End after Home', async () => {
    const painted = await paint(10)
    await painted.send(`${ESC}[H`)
    const atHome = painted.screen()
    await painted.send(`${ESC}[F`)
    const atEnd = painted.screen()
    painted.unmount()

    expect(atHome).toContain('question 01')
    expect(atEnd).toContain('answer 10')
    expect(atEnd).not.toMatch(/more rows? below/)
  })

  it('scrolls on a wheel report and never types it into the prompt', async () => {
    const painted = await paint(10)
    // Two wheel-up notches: SGR encoding, button 64, at column 12 row 30.
    await painted.send(`${ESC}[<64;12;30M`)
    const scrolled = painted.screen()
    painted.unmount()

    expect(scrolled).toMatch(/more rows? below/)
    // The report must not survive as text anywhere on screen — the prompt
    // is the only place raw input could land.
    expect(scrolled).not.toContain('64;12;30')
    expect(scrolled).not.toContain('[<64')
  })
})
