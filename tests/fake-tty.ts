/**
 * A fake TTY pair for frame-level tests: render the real `App` into a
 * string buffer, feed it keystrokes, and read the pixels back.
 *
 * Unit tests over the layout modules cannot see the bugs these harness
 * users care about — a window sliced by entry count while the box clips by
 * row, a key handler compared against a string Ink never delivers, a box
 * that grows past its cap because Ink re-wrapped a row. All of those are
 * properties of the composed frame.
 * @module @deepseek-ai/dsh-tui/tests/fake-tty
 */

import { EventEmitter } from 'node:events'
import React from 'react'
import { render } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { App } from '../src/renderer.tsx'

/** Built, never quoted: an invisible ESC byte in source is unreviewable. */
export const ESC = String.fromCharCode(27)

/** A stdout that records every frame Ink writes instead of drawing it. */
export interface FakeStdout extends EventEmitter {
  columns: number
  rows: number
  write: (chunk: string) => boolean
  frames: string[]
}

export function fakeStdout(columns: number, rows: number): FakeStdout {
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
export function fakeTtyStdin(): NodeJS.ReadStream & { send: (data: string) => void } {
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

/** Strip SGR/cursor escapes so assertions read the visible characters. */
// eslint-disable-next-line no-control-regex
export const strip = (frame: string): string => frame.replace(/\[[0-9;?]*[A-Za-z]/g, '')

/**
 * Seed a session with `turns` question/answer pairs. Two entries per turn,
 * each labelled with its turn number so a frame assertion can name the
 * oldest and the newest row without counting rows. The numbers are
 * zero-padded because `answer 1` is a substring of `answer 10`, and an
 * assertion that passes on the wrong row is worse than no assertion.
 */
export function seedSession(turns: number): Session {
  const session = Session.create('tui-frame' as never)
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

/** A mounted `App` under test. */
export interface Painted {
  /** The last frame Ink wrote, escapes removed. */
  screen: () => string
  /** Feed a chunk of stdin and let React settle. */
  send: (data: string) => Promise<void>
  unmount: () => void
}

/** How to mount the `App` for a frame test. */
export interface PaintOptions {
  /** Question/answer pairs to seed the log with. Default 0 (banner only). */
  turns?: number
  rows?: number
  columns?: number
}

const selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

/** Mount the real `App` against a fake TTY of the given size. */
export async function paintApp(
  { turns = 0, rows = 40, columns = 100 }: PaintOptions = {},
): Promise<Painted> {
  const stdout = fakeStdout(columns, rows)
  const stdin = fakeTtyStdin()
  const ctx = new Context()
  ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
  const session = seedSession(turns)
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
    {
      stdout: stdout as never,
      stdin: stdin as never,
      patchConsole: false,
      exitOnCtrlC: false,
      debug: true,
    },
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
