/**
 * How the *live* frame survives being redrawn. `banner-frame.spec.ts` pins
 * the banner's width; this file pins the two things that make Ink's eraser
 * work at all, and both were measured rather than reasoned about — the
 * second one only after a run of the real binary inside a real pty proved
 * the first fix insufficient.
 *
 * Ink erases the previous dynamic frame with `eraseLines(<logical line
 * count>)`: cursor-relative arithmetic that assumes one logical line still
 * occupies one physical row. Two things break that assumption.
 *
 *  1. **A line that fills the last column.** Terminals disagree about what
 *     that means — park the cursor in the last column and let the following
 *     newline move down one row (the VT100 reading), or wrap at once so the
 *     newline lands a row further down. Under the second reading a 3-line
 *     frame occupies six physical rows, Ink erases four, and every redraw
 *     leaks two rows. Fixed by reserving the last column
 *     (`App`'s `marginRight={1}`).
 *  2. **Reflow.** Terminals that rewrap the rows already on screen when the
 *     window narrows turn each row of the last frame into two, so the same
 *     undercount happens at *any* frame width. This is what a real window
 *     drag actually hit. Nothing about the frame can prevent it, so
 *     `useResizeRepaint` stops counting: when the resize storm goes quiet it
 *     erases the screen and lets Ink lay the frame down again.
 *
 * The debris that reflow leaves is worth recognising by eye, because it is
 * what the bug report looked like: the survivors are soft-wrapped halves, so
 * copying them out of the scrollback rejoins the top border into a
 * convincing `╭───╮` while the content row's continuation — the half
 * carrying its closing `│` — is missing.
 *
 * `Term` below is a small terminal that implements both wrap readings, an
 * optional reflow, and the five escapes Ink actually emits. The tests replay
 * a real six-step drag through it and require that exactly one prompt box
 * survives under every combination.
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

/** `` spelled out, so this file contains no literal control bytes. */
const ESC = String.fromCharCode(27)

const selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const sessionId = SessionId('tui-0f3a91c2-77bd-4e51-9a0c-1d2e3f4a5b6c')

/** What the app did, in order: terminal resizes interleaved with writes. */
type Step =
  | { kind: 'resize', columns: number }
  | { kind: 'write', text: string, columns: number }

/** A stdout stand-in that records both, in order. */
interface FakeStdout extends EventEmitter {
  columns: number
  rows: number
  write: (chunk: string) => boolean
  steps: Step[]
  resize: (columns: number) => void
}

function fakeStdout(columns: number, rows: number): FakeStdout {
  const out = new EventEmitter() as FakeStdout
  out.columns = columns
  out.rows = rows
  out.steps = []
  out.write = (text: string) => {
    out.steps.push({ kind: 'write', text, columns: out.columns })
    return true
  }
  out.resize = (next: number) => {
    out.columns = next
    // Recorded before the event fires, so the replay resizes the terminal
    // before Ink's listener writes the frame it laid out for that width.
    out.steps.push({ kind: 'resize', columns: next })
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

/** One physical row. `soft` means it continues onto the next one. */
interface Row { text: string, soft: boolean }

/**
 * A terminal: scrollback plus a screen of physical rows, the five escapes
 * Ink emits (`2K`, `nA`, `G`, `2J`/`3J`, `H`), both autowrap readings, and
 * optional reflow on resize.
 *
 * - `deferred` wrap — filling the last column only arms a pending wrap,
 *   which the next glyph consumes and a newline discards (VT100, and what
 *   every terminal worth naming actually does).
 * - `immediate` wrap — filling the last column moves to the next row at
 *   once, so a following newline costs a second row.
 * - `reflow` — on resize, rejoin soft-wrapped rows and re-split them at the
 *   new width, the way iTerm2 and Terminal.app do.
 */
class Term {
  scrollback: Row[] = []
  screen: Row[] = [{ text: '', soft: false }]
  row = 0
  col = 0
  pendingWrap = false

  constructor(
    public width: number,
    public rows: number,
    public policy: 'deferred' | 'immediate' = 'deferred',
    public reflow = false,
  ) {}

  private at(row: number): Row {
    while (this.screen.length <= row) this.screen.push({ text: '', soft: false })
    return this.screen[row] as Row
  }

  /** Move to the next row. `soft` records whether a wrap caused it. */
  private newline(soft: boolean): void {
    this.at(this.row).soft = soft
    this.pendingWrap = false
    this.row += 1
    this.col = 0
    while (this.row >= this.rows) {
      this.scrollback.push(this.screen.shift() ?? { text: '', soft: false })
      this.row -= 1
    }
    this.at(this.row)
  }

  private print(glyph: string): void {
    if (this.pendingWrap) this.newline(true)
    const row = this.at(this.row)
    const padded = row.text.length < this.col
      ? row.text + ' '.repeat(this.col - row.text.length)
      : row.text
    row.text = padded.slice(0, this.col) + glyph + padded.slice(this.col + 1)
    this.col += 1
    if (this.col >= this.width) {
      if (this.policy === 'immediate') this.newline(true)
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
          if (final === 'K') { this.at(this.row).text = ''; this.at(this.row).soft = false; this.pendingWrap = false }
          else if (final === 'A') { this.row = Math.max(0, this.row - n); this.pendingWrap = false }
          else if (final === 'G') { this.col = 0; this.pendingWrap = false }
          else if (final === 'J') {
            if (n === 2) { this.screen = [{ text: '', soft: false }]; this.row = 0; this.col = 0 }
            if (n === 3) this.scrollback = []
            this.pendingWrap = false
          }
          else if (final === 'H') { this.row = 0; this.col = 0; this.pendingWrap = false }
          i += 1 + match[0].length
          continue
        }
      }
      if (ch === '\n') { this.newline(false); i += 1; continue }
      if (ch === '\r') { this.col = 0; this.pendingWrap = false; i += 1; continue }
      this.print(ch)
      i += 1
    }
  }

  /**
   * Resize. With `reflow` off the rows are left alone (they simply get
   * clipped by the narrower window); with it on, soft-wrapped rows are
   * rejoined and re-split at the new width, and the cursor is carried along
   * by its offset within its own logical line.
   */
  resize(width: number): void {
    if (!this.reflow || width === this.width) {
      this.width = width
      return
    }
    // Where is the cursor, in logical terms?
    const groups: { text: string, rows: number[] }[] = []
    let current: { text: string, rows: number[] } | undefined
    for (const [index, row] of this.screen.entries()) {
      if (current === undefined) { current = { text: '', rows: [] }; groups.push(current) }
      current.text += row.text
      current.rows.push(index)
      if (!row.soft) current = undefined
    }
    let cursorGroup = groups.findIndex((g) => g.rows.includes(this.row))
    let cursorOffset = this.col
    if (cursorGroup >= 0) {
      for (const index of groups[cursorGroup]?.rows ?? []) {
        if (index === this.row) break
        cursorOffset += this.width
      }
    } else {
      cursorGroup = groups.length
      cursorOffset = this.col
    }

    this.width = width
    const rebuilt: Row[] = []
    const starts: number[] = []
    for (const group of groups) {
      starts.push(rebuilt.length)
      // A logical line shorter than the width still takes one row.
      const chunks: string[] = []
      for (let at = 0; at < group.text.length || chunks.length === 0; at += width) {
        chunks.push(group.text.slice(at, at + width))
      }
      for (const [index, text] of chunks.entries()) {
        rebuilt.push({ text, soft: index < chunks.length - 1 })
      }
    }
    this.screen = rebuilt.length > 0 ? rebuilt : [{ text: '', soft: false }]
    const start = starts[cursorGroup] ?? this.screen.length - 1
    this.row = Math.min(start + Math.floor(cursorOffset / width), this.screen.length - 1)
    this.col = cursorOffset % width
    while (this.screen.length > this.rows) {
      this.scrollback.push(this.screen.shift() ?? { text: '', soft: false })
      this.row = Math.max(0, this.row - 1)
    }
  }

  /**
   * Everything the user could select and copy — scrollback then screen, with
   * soft-wrapped rows rejoined, which is what a terminal puts on the
   * clipboard and therefore what a pasted bug report shows.
   */
  copied(): string[] {
    const out: string[] = []
    let pending = ''
    for (const row of [...this.scrollback, ...this.screen]) {
      pending += row.text
      if (!row.soft) { out.push(pending); pending = '' }
    }
    if (pending !== '') out.push(pending)
    return out
  }
}

/**
 * Mount the real `App` against a fake TTY, replay `widths` as `resize`
 * events, and return the ordered list of resizes and writes. Non-debug mode
 * on purpose: the `log-update` path with its line-counting eraser is the
 * thing under test.
 */
async function storm(widths: number[]): Promise<Step[]> {
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
  // Ink throttles renders at 32ms with a trailing call, so each drag step
  // needs more than that to land as its own frame — that is what makes this
  // a storm rather than one coalesced redraw. The steps stay *under*
  // `useResizeRepaint`'s 120ms settle, so the repaint has to coalesce the
  // whole drag into a single repaint at the end, and the final wait is long
  // enough to catch it.
  const settle = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })
  await settle(60)
  for (const columns of widths) {
    stdout.resize(columns)
    await settle(60)
  }
  await settle(300)
  instance.unmount()
  return stdout.steps
}

/** The widths a real window drag stepped through, from the pty trace. */
const DRAG = [97, 83, 81, 78, 65, 102]

/**
 * Count prompt boxes the way the user counted them — by pasting the
 * scrollback and looking. The placeholder appears once per box drawn and
 * nowhere else, which survives the terminal rejoining soft-wrapped rows
 * (border counting does not: a debris row and the frame drawn under it can
 * end up as one copied line).
 */
const boxes = (term: Term): number =>
  term.copied().join('\n').split('Ask dsh anything').length - 1

describe('live frame erasure', () => {
  it('never lets a rendered line fill the terminal’s last column', async () => {
    for (const step of await storm([])) {
      if (step.kind !== 'write') continue
      const visible = step.text.replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g'), '')
      for (const line of visible.split('\n')) {
        expect(displayWidth(line)).toBeLessThanOrEqual(step.columns - 1)
      }
    }
  })

  it('clears the stale frame on every resize event', async () => {
    const steps = await storm(DRAG)
    const clears = steps.filter(
      (step): step is Extract<Step, { kind: 'write' }> =>
        step.kind === 'write' && step.text.includes(`${ESC}[2J${ESC}[H`),
    )

    expect(clears.length).toBeGreaterThanOrEqual(DRAG.length)
  })

  // The drag ends with a repaint, and a repaint clears the screen — so the
  // banner (static output, written once, above the frame) goes with it and
  // exactly one prompt is left. Anything more is a frame the eraser failed to
  // remove. `was` is what each case measured with `useResizeRepaint` disabled:
  // the two non-reflowing readings are already clean, because reserving the
  // last column (`marginRight={1}`, commit 2ab806d) keeps the logical and
  // physical row counts equal. Reflow breaks that equality no matter how wide
  // the frame is, and only the repaint recovers from it.
  const cases = [
    { policy: 'deferred', reflow: false, was: 1 },
    { policy: 'immediate', reflow: false, was: 1 },
    { policy: 'deferred', reflow: true, was: 6 },
    { policy: 'immediate', reflow: true, was: 6 },
  ] as const

  for (const { policy, reflow, was } of cases) {
    it(`leaves one prompt after a drag (${policy} wrap${reflow ? ', reflowing' : ''}) — was ${was}`, async () => {
      const steps = await storm(DRAG)
      const term = new Term(102, 26, policy, reflow)
      for (const step of steps) {
        if (step.kind === 'resize') term.resize(step.columns)
        else term.write(step.text)
      }
      expect(boxes(term)).toBe(1)
    })
  }

  it('leaves the surviving prompt row whole', async () => {
    // The reported bug had a shape, not just a count: each residue block was a
    // complete `╭───╮` (the copy rejoins the two halves of a soft-wrapped
    // border) above a content row with no closing `│`, because that half had
    // been erased. So it is not enough to end with one prompt row — the row
    // has to be a whole one. With the repaint disabled this found six rows,
    // several of them a debris row and the frame beneath it run together.
    const steps = await storm(DRAG)
    const term = new Term(102, 26, 'deferred', true)
    for (const step of steps) {
      if (step.kind === 'resize') term.resize(step.columns)
      else term.write(step.text)
    }
    const rows = term.copied().filter((line) => line.includes('Ask dsh anything'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.trimEnd().endsWith('│')).toBe(true)
  })
})

describe('status bar inside the reserved frame', () => {
  // The StatusBar is the live frame's other framed child, and the one that
  // does its own width arithmetic (`fitModelName` against a budget derived
  // from the column count). If that budget is off by even one the frame
  // overflows and the eraser breaks for the rest of the session — the same
  // failure the prompt box had, just needing a long model name or a narrow
  // window to show up. So: measure, at widths from generous to absurd, with
  // the longest plausible model name and seven-figure counts.
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

      const last = stdout.steps.at(-1)
      const visible = (last?.kind === 'write' ? last.text : '')
        .replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g'), '')
      for (const line of visible.split('\n')) {
        expect(displayWidth(line)).toBeLessThanOrEqual(columns - 1)
      }
    })
  }
})
