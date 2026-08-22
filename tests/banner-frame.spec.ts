/**
 * The banner's rendered *frame*, as opposed to its pure helpers (those
 * live in `banner.spec.ts`). Only one property is pinned here, because
 * only one property has ever broken the terminal: **no rendered line
 * may be wider than the terminal**.
 *
 * That is not cosmetic. Ink erases the previous dynamic frame with
 * `eraseLines(<logical line count>)`. A line wider than the terminal is
 * wrapped by the terminal into two physical rows, so the count is short
 * and the erase leaves the excess on screen — which is how a resize
 * during startup once left ten shredded copies of the banner behind.
 * A clipped tail is a cosmetic bug; a spilled line corrupts every frame
 * that follows it.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import React from 'react'
import { Box, render } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Banner } from '../src/components/Banner.tsx'
import { displayWidth } from '../src/width.ts'
import { App } from '../src/renderer.tsx'

/**
 * A writable stand-in for a TTY: collects every frame Ink writes and can
 * fire the `resize` event Ink subscribes to.
 */
interface FakeStdout extends EventEmitter {
  columns: number
  rows: number
  write: (chunk: string) => boolean
  frames: string[]
  resize: (columns: number) => void
}

function fakeStdout(columns: number): FakeStdout {
  const out = new EventEmitter() as FakeStdout
  out.columns = columns
  out.rows = 40
  out.frames = []
  out.write = (chunk: string) => {
    out.frames.push(chunk)
    return true
  }
  out.resize = (next: number) => {
    out.columns = next
    out.emit('resize')
  }
  return out
}

/**
 * A stdin that claims to be a TTY. Without this Ink's `useInput` throws
 * "raw mode is not supported" from a passive effect, and that abort
 * leaves React's pending state updates unapplied — including the one
 * `<Static>` uses to mark its items as written. A test on a pipe would
 * therefore show the banner re-emitted on every resize and blame the
 * component for something only the test harness caused.
 */
function fakeTtyStdin(): NodeJS.ReadStream {
  const stdin = new EventEmitter() as never as NodeJS.ReadStream & { setRawMode: () => void }
  return Object.assign(stdin, {
    isTTY: true,
    setEncoding: () => stdin,
    setRawMode: () => stdin,
    read: () => null,
    ref: () => stdin,
    unref: () => stdin,
    resume: () => stdin,
    pause: () => stdin,
  }) as never
}

const selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const sessionId = SessionId('tui-0f3a91c2-77bd-4e51-9a0c-1d2e3f4a5b6c')

/** Strip the SGR/cursor escapes so the widths measured are the visible ones. */
// eslint-disable-next-line no-control-regex
const strip = (frame: string): string => frame.replace(/\[[0-9;]*[A-Za-z]/g, '')

/**
 * Render the banner the way `renderer.tsx` does — inside a full-height
 * column, which is what stretches the frame to the terminal's width —
 * and return the last frame plus a resize hook.
 */
async function paint(columns: number): Promise<{
  frame: () => string[]
  resize: (columns: number) => Promise<void>
  unmount: () => void
}> {
  const stdout = fakeStdout(columns)
  const element = React.createElement(
    Box,
    { flexDirection: 'column', height: '100%' },
    React.createElement(Banner, { selection, sessionId }),
  )
  // `debug: true` makes Ink write whole frames instead of cursor-relative
  // patches, which is what lets a test measure line widths at all.
  const instance = render(element, { stdout: stdout as never, patchConsole: false, debug: true })
  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20) })
  await settle()
  return {
    frame: () => strip(stdout.frames.at(-1) ?? '').split('\n').filter((l) => l !== ''),
    async resize(next: number) {
      stdout.resize(next)
      await settle()
    },
    unmount: () => { instance.unmount() },
  }
}

const widest = (lines: string[]): number => Math.max(...lines.map(displayWidth))

describe('banner frame', () => {
  // One width per tier plus both sides of both cliffs.
  for (const columns of [120, 100, 76, 75, 60, 45, 44, 30, 20]) {
    it(`fits inside a ${columns}-column terminal`, async () => {
      const painted = await paint(columns)
      expect(widest(painted.frame())).toBeLessThanOrEqual(columns)
      painted.unmount()
    })
  }

  it('clips rather than spills when the terminal shrinks under it', async () => {
    // The regression. Ink relays out the tree synchronously on `resize`
    // but does not re-render React, so the banner is laid out at 60
    // columns while still holding the tier it chose at 100. Every column
    // must therefore be squeezable: the art loses its tail, and nothing
    // crosses the right edge.
    const painted = await paint(100)
    const before = painted.frame()
    await painted.resize(60)
    const after = painted.frame()
    painted.unmount()

    expect(widest(after)).toBeLessThanOrEqual(60)
    // Squeezing must not add rows either — that is what `wrap="truncate"`
    // on every `<Text>` buys, and what once slid the meta lines out of
    // the frame.
    expect(after.length).toBe(before.length)
  })
})

describe('banner under a resize storm', () => {
  it('is written exactly once no matter how many resize events arrive', async () => {
    // The reported bug, reproduced end to end: a terminal that emits a
    // burst of `resize` events while starting up (window animation, tab
    // reflow, tmux attach) used to make Ink redraw the banner for each
    // one, and its line-counting eraser could not remove what the
    // terminal had wrapped — so the screen filled with shredded copies.
    // As static output the banner is written once and never redrawn.
    const stdout = fakeStdout(91)
    const ctx = new Context()
    ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
    const agent = {
      id: sessionId,
      session: { id: sessionId, events: [] },
      status: 'idle',
      cancel: () => {}, followup: () => {}, steer: () => {}, inject: () => {},
      whenIdle: () => Promise.resolve(),
      on: () => () => {},
    }
    const instance = render(
      React.createElement(App, { ctx, agent: agent as never, exit: () => {} }),
      {
        stdout: stdout as never,
        stdin: fakeTtyStdin(),
        patchConsole: false,
        exitOnCtrlC: false,
      },
    )
    // The widths the reported session actually stepped through.
    for (const columns of [90, 89, 88, 86, 84, 80, 79, 70, 68, 67, 102]) {
      stdout.resize(columns)
      await new Promise((resolve) => { setTimeout(resolve, 5) })
    }
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    instance.unmount()

    const written = strip(stdout.frames.join(''))
    // The slogan appears once per banner drawn, and only in the banner.
    expect(written.split('探索未至之境').length - 1).toBe(1)
  })
})
