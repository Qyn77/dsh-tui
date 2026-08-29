/**
 * A settled resize must leave a frame on the screen — even when the frame it
 * settles on is the one Ink already had.
 *
 * `frame-erase.spec.ts` covers the *other* half of resize: what the eraser
 * leaves behind. This file covers the half that had no coverage and that the
 * resize lesson listed as an unresolved symptom ("a blank screen after the
 * drag stopped"): the repaint owner in `resize.ts` clears the alternate
 * screen itself, so if Ink then declines to draw, nothing is on screen at
 * all.
 *
 * Ink declines whenever the newly rendered string equals the frame it last
 * wrote (`ink/ink.js`: `output !== this.lastOutput`), and `instance.clear()`
 * resets `log-update`'s line bookkeeping without touching that cached
 * string. Both cases below are byte-identical frames reached by ordinary
 * gestures, and both used to end with an empty terminal:
 *
 *   - dragging the bottom edge (rows change, columns do not, and an empty
 *     session's `frameHeight` is `undefined` so nothing in the layout reads
 *     rows at all);
 *   - dragging out and back to the starting width.
 *
 * The assertion is deliberately about what a user would see rather than
 * about which Ink method ran: replay every write into the same `Term` model
 * `frame-erase.spec.ts` uses, then look for the prompt.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { App } from '../src/renderer.tsx'
import { installResizeOwner, type RepaintRef } from '../src/resize.ts'

/** `\u001B` spelled out, so this file contains no literal control bytes. */
const ESC = String.fromCharCode(27)
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`

const selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const sessionId = SessionId('tui-0f3a91c2-77bd-4e51-9a0c-1d2e3f4a5b6c')

/** The prompt placeholder: one occurrence per prompt box actually drawn. */
const PROMPT = 'Ask dsh anything'

/**
 * A stdout stand-in that is a TTY, so the App takes the real-TTY branch
 * (dynamic banner) and `useResizeRepaint` stands down for the owner under
 * test. Writes are accumulated in order.
 */
interface FakeTty extends EventEmitter {
  isTTY: true
  columns: number
  rows: number
  write: (chunk: string) => boolean
  written: string[]
  resize: (columns: number, rows: number) => void
}

function fakeTty(columns: number, rows: number): FakeTty {
  const out = new EventEmitter() as FakeTty
  out.isTTY = true
  out.columns = columns
  out.rows = rows
  out.written = []
  out.write = (chunk: string) => {
    out.written.push(chunk)
    return true
  }
  out.resize = (nextColumns: number, nextRows: number) => {
    out.columns = nextColumns
    out.rows = nextRows
    out.emit('resize')
  }
  return out
}

/** See `banner-frame.spec.ts`: `useInput` needs a TTY stdin to exist. */
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
  })
}

const settle = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Mount the real App behind the real resize owner, replay a drag, and return
 * everything written to the terminal.
 */
async function drag(steps: [columns: number, rows: number][]): Promise<string> {
  const stdout = fakeTty(102, 26)
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
  const repaint: RepaintRef = { current: undefined }
  const element = (): React.ReactElement =>
    React.createElement(App, { ctx, agent: agent as never, exit: () => {}, repaint })
  const instance = render(element(), {
    stdout: stdout as never,
    stdin: fakeTtyStdin(),
    patchConsole: false,
    exitOnCtrlC: false,
  })
  const detach = installResizeOwner({
    stdout,
    clear: instance.clear,
    rerender: () => { instance.rerender(element()) },
    repaint,
    quietMs: 40,
  })
  // Let the first frame land, and let the mount effect publish the writer.
  await settle(60)
  const before = stdout.written.length
  for (const [columns, rows] of steps) {
    stdout.resize(columns, rows)
    await settle(20)
  }
  await settle(120)
  detach()
  instance.unmount()
  return stdout.written.slice(before).join('')
}

describe('settled resize repaint', () => {
  it('redraws after a height-only drag, where the frame is unchanged', async () => {
    // An empty session has no `height` on the root box, so changing rows
    // produces the same frame Ink already wrote. Ink suppresses that write;
    // the owner has to force it. The terminal has to be tall enough for the
    // frame to fit, or Ink's `outputHeight >= rows` branch would draw it
    // unconditionally and the case would pass for the wrong reason.
    const output = await drag([[102, 40], [102, 36]])
    expect(output).toContain(PROMPT)
  })

  it('redraws after a drag that ends at the starting width', async () => {
    const output = await drag([[83, 26], [65, 26], [102, 26]])
    expect(output).toContain(PROMPT)
  })

  it('redraws after a width change', async () => {
    const output = await drag([[70, 26]])
    expect(output).toContain(PROMPT)
  })

  it('clears the screen before the frame it repaints', async () => {
    const output = await drag([[102, 20]])
    const clear = output.lastIndexOf(CLEAR_SCREEN)
    expect(clear).toBeGreaterThanOrEqual(0)
    // The surviving frame is written after the last clear, not before it.
    expect(output.indexOf(PROMPT, clear)).toBeGreaterThan(clear)
  })

  it('coalesces a storm into one visible frame', async () => {
    // Whatever the owner writes on the way there, what is left standing after
    // the last screen clear is one prompt. (The settled rerender and the
    // forced repaint can each emit the frame; only the second is visible,
    // because the repaint clears the screen before writing it.)
    const output = await drag([[97, 26], [83, 26], [78, 26], [65, 26]])
    const visible = output.slice(output.lastIndexOf(CLEAR_SCREEN))
    expect(visible.split(PROMPT)).toHaveLength(2)
  })

  it('detaches its listener', async () => {
    const stdout = fakeTty(80, 24)
    const detach = installResizeOwner({
      stdout,
      clear: () => {},
      rerender: () => {},
      repaint: { current: undefined },
      quietMs: 10,
    })
    detach()
    stdout.resize(70, 24)
    await settle(40)
    expect(stdout.written).toHaveLength(0)
  })
})
