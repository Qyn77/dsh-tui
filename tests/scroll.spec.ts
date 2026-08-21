/**
 * The scroll module is pure, and it is where the scrolling bug actually
 * lived: the old viewport paged by *entry count* while the terminal clips
 * by *row*, so the two units never agreed and the newest messages ended up
 * below a clipped edge that no key could reach. These tests pin the units.
 *
 * The decoding tests earn their keep just as much. `Home`/`End` were
 * documented in both READMEs and implemented as a comparison against an
 * escape sequence that Ink can never deliver — it blanks `input` for those
 * keys. Asserting on the actual bytes is the only thing that keeps that
 * class of dead binding out.
 */

import { describe, expect, it } from 'vitest'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  clampOffset,
  estimateEntryRows,
  halfPageDelta,
  isMouseReport,
  MOUSE_WHEEL_ROWS,
  pageDelta,
  parseNavKey,
  parseWheelDelta,
  windowStart,
} from '../src/scroll.ts'
import type { UiEntry } from '../src/types.ts'

/** Built rather than quoted, so the byte is visible in the source. */
const ESC = String.fromCharCode(27)

function userEntry(text: string): UiEntry {
  return {
    kind: 'user',
    message: createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    }),
  }
}

describe('page arithmetic', () => {
  it('keeps two rows of overlap so a page turn does not lose the reader', () => {
    expect(pageDelta(20)).toBe(18)
    expect(halfPageDelta(20)).toBe(10)
  })

  it('never returns a zero step, however small the viewport', () => {
    for (const rows of [0, 1, 2, 3]) {
      expect(pageDelta(rows)).toBeGreaterThanOrEqual(1)
      expect(halfPageDelta(rows)).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('clampOffset', () => {
  it('pins to the newest row when the content fits the viewport', () => {
    // Nothing is hidden, so no offset is reachable — this is what keeps a
    // short session glued to the bottom instead of drifting upward.
    expect(clampOffset(0, 5, 20)).toBe(0)
    expect(clampOffset(9, 5, 20)).toBe(0)
  })

  it('allows exactly the rows that stick out above the viewport', () => {
    expect(clampOffset(100, 50, 20)).toBe(30)
    expect(clampOffset(30, 50, 20)).toBe(30)
    expect(clampOffset(7, 50, 20)).toBe(7)
  })

  it('treats junk and negatives as the tail', () => {
    expect(clampOffset(-4, 50, 20)).toBe(0)
    expect(clampOffset(Number.NaN, 50, 20)).toBe(0)
  })
})

describe('mouse reports', () => {
  it('recognises the encodings Ink passes through as ordinary input', () => {
    // Ink strips the leading ESC before handing input to the app, so the
    // payload the Prompt has to reject starts at '['.
    expect(isMouseReport('[<64;12;30M')).toBe(true)
    expect(isMouseReport('[<0;1;1m')).toBe(true)
    expect(isMouseReport('[Ma!!')).toBe(true)
    expect(isMouseReport('hello')).toBe(false)
    expect(isMouseReport('[5~')).toBe(false)
  })

  it('turns wheel notches into signed rows and ignores clicks', () => {
    expect(parseWheelDelta('[<64;12;30M')).toBe(MOUSE_WHEEL_ROWS)
    expect(parseWheelDelta('[<65;12;30M')).toBe(-MOUSE_WHEEL_ROWS)
    // Buttons 0-2 are clicks and drags; the TUI has nothing clickable.
    expect(parseWheelDelta('[<0;12;30M')).toBe(0)
    expect(parseWheelDelta('[<2;12;30m')).toBe(0)
  })

  it('sums a burst of notches delivered in one chunk', () => {
    // A fast spin outruns the event loop and arrives as one payload.
    expect(parseWheelDelta('[<64;1;1M[<64;1;1M[<64;1;1M')).toBe(3 * MOUSE_WHEEL_ROWS)
    expect(parseWheelDelta('[<64;1;1M[<65;1;1M')).toBe(0)
  })

  it('reads modified wheel events as plain wheel events', () => {
    // Shift/Meta/Ctrl set the higher bits; the direction stays in bit 0.
    expect(parseWheelDelta('[<68;1;1M')).toBe(MOUSE_WHEEL_ROWS)
    expect(parseWheelDelta('[<69;1;1M')).toBe(-MOUSE_WHEEL_ROWS)
  })
})

describe('parseNavKey', () => {
  it('decodes every Home/End form a terminal may send', () => {
    for (const seq of [`${ESC}[H`, `${ESC}OH`, `${ESC}[1~`, `${ESC}[7~`]) {
      expect(parseNavKey(seq)).toBe('home')
    }
    for (const seq of [`${ESC}[F`, `${ESC}OF`, `${ESC}[4~`, `${ESC}[8~`]) {
      expect(parseNavKey(seq)).toBe('end')
    }
  })

  it('reads raw bytes, not the ESC-stripped form useInput would hand over', () => {
    // The listener is on stdin, ahead of Ink's normalisation. If this ever
    // starts matching the stripped form, the binding is reading the wrong
    // stream — which is the bug the old Home/End code had.
    expect(parseNavKey('[H')).toBeUndefined()
    expect(parseNavKey('[5~')).toBeUndefined()
    expect(parseNavKey('a')).toBeUndefined()
    expect(parseNavKey('')).toBeUndefined()
  })
})

describe('estimateEntryRows', () => {
  it('counts the chrome every block carries', () => {
    // marginY (2) + header (1) + one row of text.
    expect(estimateEntryRows(userEntry('hi'), 80)).toBe(4)
    expect(estimateEntryRows({ kind: 'note', text: 'x' }, 80)).toBe(3)
  })

  it('grows with wrapped text', () => {
    const short = estimateEntryRows(userEntry('a'.repeat(10)), 40)
    const long = estimateEntryRows(userEntry('a'.repeat(400)), 40)
    expect(long).toBeGreaterThan(short)
  })

  it('counts each hard line break', () => {
    expect(estimateEntryRows(userEntry('a\nb\nc'), 80)).toBe(6)
  })

  it('counts a tool card down to its border rows', () => {
    const rows = estimateEntryRows(
      {
        kind: 'tool',
        callId: CallId('call-1'),
        name: 'bash',
        args: '{"command":"ls"}',
        turn: 1,
        step: 1,
        status: 'running',
      },
      80,
    )
    // marginY 2 + border 2 + header 1 + args 1.
    expect(rows).toBe(6)
  })
})

describe('windowStart', () => {
  it('mounts everything for a short log', () => {
    const entries = Array.from({ length: 5 }, (_, i) => userEntry(`m${i}`))
    expect(windowStart(entries, 80, 0, 20)).toBe(0)
  })

  it('always reaches the newest entry, which is what makes the offset exact', () => {
    const entries = Array.from({ length: 400 }, (_, i) => userEntry(`m${i}`))
    const start = windowStart(entries, 80, 0, 20)
    expect(start).toBeGreaterThan(0)
    expect(start).toBeLessThan(entries.length)
  })

  it('mounts further back as the offset grows', () => {
    const entries = Array.from({ length: 400 }, (_, i) => userEntry(`m${i}`))
    const near = windowStart(entries, 80, 0, 20)
    const far = windowStart(entries, 80, 300, 20)
    expect(far).toBeLessThan(near)
  })

  it('mounts more rows than the offset asks for, so scrolling up finds them laid out', () => {
    const entries = Array.from({ length: 400 }, (_, i) => userEntry(`m${i}`))
    const viewportRows = 20
    const offset = 100
    const start = windowStart(entries, 80, offset, viewportRows)
    const mountedRows = entries
      .slice(start)
      .reduce((sum, entry) => sum + estimateEntryRows(entry, 80), 0)
    expect(mountedRows).toBeGreaterThanOrEqual(offset + viewportRows)
  })

  it('clamps to the start of the log rather than running off the front', () => {
    const entries = Array.from({ length: 30 }, (_, i) => userEntry(`m${i}`))
    expect(windowStart(entries, 80, 10_000, 20)).toBe(0)
  })
})
