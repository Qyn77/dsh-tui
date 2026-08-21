/**
 * How the *live* frame survives being redrawn. `banner-frame.spec.ts` pins
 * the banner's width; this file pins the one thing that makes Ink's eraser
 * work at all.
 *
 * Ink erases the previous dynamic frame with `eraseLines(<logical line
 * count>)` — a count of `\n`s, not of physical terminal rows. The two agree
 * only while every line is *narrower* than the terminal. A line that fills
 * the last column leaves the terminal with a wrap decision, and terminals
 * disagree about it: park the cursor in the last column and let the next
 * newline move down one row (the VT100 reading), or wrap immediately so the
 * newline lands a row further down. Under the second reading a 3-line frame
 * occupies 6 physical rows, Ink erases 4, and every redraw leaks 2 rows
 * onto the screen — which is precisely the ladder of half-drawn prompt
 * boxes a window drag used to leave behind.
 *
 * The tests below replay a real resize storm through a small terminal
 * emulator under both readings, plus a one-column lag between the resize
 * event and the write (what a fast drag does to `stdout.columns`). All
 * three must end with exactly one prompt box on screen. The frame keeps the
 * last column empty, so none of them can wrap it.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import React from 'react'
import { Box, render } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { displayWidth } from '../src/components/Banner.tsx'
import { StatusBar } from '../src/components/StatusBar.tsx'
import { App } from '../src/renderer.tsx'

/** ``, spelled out so this file contains no literal control bytes. */
const ESC = String.fromCharCode(27)

const selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const sessionId = SessionId('tui-0f3a91c2-77bd-4e51-9a0c-1d2e3f4a5b6c')

/** A stdout stand-in that records the terminal width in force at each write. */
interface FakeStdout extends EventEmitter {
  columns: number
  rows: number
  write: (chunk: string) => boolean
  chunks: { text: string, columns: number }[]
  resize: (columns: number) => void
}

function fakeStdout(columns: number, rows: number): FakeStdout {
  const out = new EventEmitter() as FakeStdout
  out.columns = columns
  out.rows = rows
  out.chunks = []
  out.write = (text: string) => {
    out.chunks.push({ text, columns: out.columns })
    return true
  }
  out.resize = (next: number) => {
    out.columns = next
    out.emit('resize')
  }
  return out
}

/** See the note in `banner-frame.spec.ts`: `useInput` needs a TTY to exist. */
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

/**
 * A terminal: scrollback plus a screen grid, understanding the handful of
 * escapes Ink actually emits (`2K`, `nA`, `G`, `2J`/`3J`, `H`) and both
 * autowrap readings.
 *
 * - `deferred` — filling the last column only arms a pending wrap, which a
 *   newline consumes. This is what VT100-lineage terminals do.
 * - `immediate` — filling the last column moves to the next row at once, so
 *   the newline that follows costs a second row.
 */
class Term {
  scrollback: string[] = []
  screen: string[] = ['']
  row = 0
  col = 0
  pendingWrap = false

  constructor(
    public width: number,
    public rows: number,
    public policy: 'deferred' | 'immediate',
  ) {}

  private at(row: number): string {
    while (this.screen.length <= row) this.screen.push('')
    return this.screen[row] ?? ''
  }

  private newline(): void {
    this.pendingWrap = false
    this.row += 1
    this.col = 0
    while (this.row >= this.rows) {
      this.scrollback.push(this.screen.shift() ?? '')
      this.row -= 1
    }
    this.at(this.row)
  }

  private print(glyph: string): void {
    if (this.pendingWrap) this.newline()
    const line = this.at(this.row)
    const padded = line.length < this.col ? line + ' '.repeat(this.col - line.length) : line
    this.screen[this.row] = padded.slice(0, this.col) + glyph + padded.slice(this.col + 1)
    this.col += 1
    if (this.col >= this.width) {
      if (this.policy === 'immediate') this.newline()
      else this.pendingWrap = true
    }
  }

  write(chunk: string): void {
    let i = 0
    while (i < chunk.length) {
      const ch = chunk[i] ?? ''
      if (ch === ESC && chunk[i + 1] === '[') {
        const match = /^\[([0-9;]*)([A-Za-z])/.exec(chunk.slice(i + 1))
        if (match) {
          const params = match[1] ?? ''
          const final = match[2]
          const n = params === '' ? 1 : Number.parseInt(params, 10)
          if (final === 'K') { this.screen[this.row] = ''; this.pendingWrap = false }
          else if (final === 'A') { this.row = Math.max(0, this.row - n); this.pendingWrap = false }
          else if (final === 'G') { this.col = 0; this.pendingWrap = false }
          else if (final === 'J') { if (n === 2) this.screen = ['']; if (n === 3) this.scrollback = [] }
          else if (final === 'H') { this.row = 0; this.col = 0; this.pendingWrap = false }
          i += 1 + match[0].length
          continue
        }
      }
      if (ch === '\n') { this.newline(); i += 1; continue }
      if (ch === '\r') { this.col = 0; this.pendingWrap = false; i += 1; continue }
      this.print(ch)
      i += 1
    }
  }

  /** Everything the user can scroll back to, plus what is on screen now. */
  lines(): string[] {
    return [...this.scrollback, ...this.screen]
  }
}

/**
 * Mount the real `App` against a fake TTY and replay `widths` as `resize`
 * events, returning every chunk Ink wrote along with the width it was
 * written at. Non-debug mode on purpose: the `log-update` path with its
 * line-counting eraser is the thing under test.
 */
async function storm(widths: number[]): Promise<{ text: string, columns: number }[]> {
  const stdout = fakeStdout(102, 26)
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
    { stdout: stdout as never, stdin: fakeTtyStdin(), patchConsole: false, exitOnCtrlC: false },
  )
  // Ink throttles renders at 32ms with a trailing call, so each step has to
  // be given more than that to land as its own frame — which is what makes
  // this a storm rather than one coalesced redraw.
  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 60) })
  await settle()
  for (const columns of widths) {
    stdout.resize(columns)
    await settle()
  }
  await settle()
  instance.unmount()
  return stdout.chunks
}

/** The widths a window drag steps through, one column at a time. */
const DRAG = [101, 100, 99, 98, 97, 96]

describe('live frame erasure', () => {
  it('never lets a rendered line fill the terminal’s last column', async () => {
    const chunks = await storm([])
    for (const { text, columns } of chunks) {
      // eslint-disable-next-line no-control-regex
      const visible = text.replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g'), '')
      for (const line of visible.split('\n')) {
        expect(displayWidth(line)).toBeLessThanOrEqual(columns - 1)
      }
    }
  })

  for (const [policy, lag] of [['deferred', 0], ['immediate', 0], ['deferred', 1]] as const) {
    it(`leaves one prompt box after a resize storm (${policy} wrap, ${lag}-column lag)`, async () => {
      const chunks = await storm(DRAG)
      const term = new Term(102, 26, policy)
      for (const { text, columns } of chunks) {
        // A lag models `stdout.columns` trailing the real window during a
        // fast drag: Ink lays out one column wider than the terminal is.
        term.width = columns - lag
        term.write(text)
      }
      // Two boxes are drawn in total — the banner (static, written once)
      // and the prompt. Anything more is a frame the eraser failed to
      // remove. Before the reserved column this reported 8.
      const boxes = term.lines().filter((line) => line.startsWith('╭')).length
      expect(boxes).toBe(2)
    })
  }
})

describe('status bar inside the reserved frame', () => {
  // The StatusBar is the live frame's other framed child, and it is the one
  // that does its own width arithmetic (`fitModelName` against a budget
  // derived from the column count). If that budget is off by even one, the
  // frame overflows and the eraser breaks for the rest of the session — the
  // same failure the prompt box had, just needing a long model name or a
  // narrow window to show up. So: measure, at widths from generous to
  // absurd, with the longest plausible model name and seven-figure counts.
  const state = {
    status: 'running',
    currentTurn: 3,
    entries: [
      {
        kind: 'assistant',
        turn: 1,
        step: 1,
        text: 'hi',
        finalized: true,
        usage: { inputTokens: 1_234_567, outputTokens: 7_654_321 },
      },
    ],
  }
  const longSelection = {
    provider: 'deepseek-official-enterprise-eu-west',
    model: 'deepseek-v4-flash-preview-2026-08-21-high-effort',
  }

  for (const columns of [120, 100, 80, 60, 45, 30, 20]) {
    it(`fits inside a ${columns}-column terminal`, async () => {
      const stdout = fakeStdout(columns, 40)
      const instance = render(
        React.createElement(
          Box,
          { flexDirection: 'column', height: '100%', marginRight: 1 },
          React.createElement(StatusBar, {
            selection: longSelection,
            sessionId,
            state: state as never,
            spinnerFrame: 0,
            elapsedSeconds: 12,
          }),
        ),
        { stdout: stdout as never, patchConsole: false, debug: true },
      )
      await new Promise((resolve) => { setTimeout(resolve, 20) })
      instance.unmount()

      const last = stdout.chunks.at(-1)?.text ?? ''
      const visible = last.replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g'), '')
      for (const line of visible.split('\n')) {
        expect(displayWidth(line)).toBeLessThanOrEqual(columns - 1)
      }
    })
  }
})
