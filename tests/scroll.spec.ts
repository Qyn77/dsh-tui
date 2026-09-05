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
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { EXPANDED_MAX_LINES, PREVIEW_MAX_LINES } from '../src/message-layout.ts'
import {
  clampOffset,
  estimateEntryRows,
  halfPageDelta,
  isMouseReport,
  isOscTail,
  MOUSE_WHEEL_ROWS,
  pageDelta,
  parseNavKey,
  parseWheelDelta,
  windowStart,
} from '../src/scroll.ts'
import type { UiEntry } from '../src/types.ts'

/** Built rather than quoted, so the byte is visible in the source. */
const ESC = String.fromCharCode(27)

function userEntry(text: string, images = 0, name = 'shot.png'): UiEntry {
  return {
    kind: 'user',
    message: createUserMessage({
      content: [
        ...Array.from({ length: images }, (_, i) => ({
          type: 'image' as const,
          attachment: {
            attachmentId: `att-${String(i)}` as never,
            mediaType: 'image/png' as const,
            bytes: 1_000,
            width: 10,
            height: 10,
            name,
          },
        })),
        ...(text === '' ? [] : [{ type: 'text' as const, text }]),
      ],
      source: { kind: 'user' },
    }),
  }
}

function assistantEntry(text: string): UiEntry {
  return { kind: 'assistant', text, turn: 1, step: 1, finalized: true }
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

  it('recognises the tail of an OSC report whose ESC Ink ate', () => {
    // Ink's key parser does not understand OSC sequences — it peels the
    // leading ESC as a lone Escape key and hands the rest to `useInput` as
    // text. A VS Code terminal that spontaneously sends an OSC 11 report
    // would otherwise be typed into the prompt as `]11;rgb:…`.
    expect(isOscTail(']11;rgb:1919/1a1a/1b1b')).toBe(true)
    expect(isOscTail(']10;rgb:f/f/f')).toBe(true)
    expect(isOscTail(']52;c;base64data')).toBe(true)
    expect(isOscTail('hello world')).toBe(false)
    expect(isOscTail('[5~')).toBe(false)
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
  it('charges an entry for its separator and the rows it draws', () => {
    // One blank row of separation plus one row of text — no bottom margin,
    // and no border on anything but a user message. Anything more would
    // over-count, and over-counting is what puts history out of reach.
    expect(estimateEntryRows({ kind: 'note', text: 'x' }, 80)).toBe(2)
  })

  it('charges a user message for the frame around it', () => {
    // Separator, the box's two rows, and the one row of text inside it.
    expect(estimateEntryRows(userEntry('hi'), 80)).toBe(4)
  })

  it('wraps a user message inside its frame, not across the full width', () => {
    // A line that fits the gutter width but not the four columns the border
    // and padding take. Charging the box's rows without narrowing the text
    // would call this one row and under-count every message that wraps.
    const text = 'a'.repeat(78 - 2)
    expect(estimateEntryRows(userEntry(text), 80)).toBe(5)
  })

  it('charges one row per attachment chip, and no more', () => {
    // Every chip is drawn `truncate-end`, so its height is independent of the
    // filename's length and of the frame's width. Estimating instead of
    // counting would put the oldest messages out of reach the moment someone
    // attaches a screenshot with a long name.
    expect(estimateEntryRows(userEntry('hi', 1), 80)).toBe(5)
    expect(estimateEntryRows(userEntry('hi', 3), 80)).toBe(7)
  })

  it('charges nothing for a text row a message-of-only-images does not draw', () => {
    // Separator, the box's two rows, one chip. The `|| ' '` fallback that keeps
    // an empty frame from collapsing must not add a row here.
    expect(estimateEntryRows(userEntry('', 1), 80)).toBe(4)
  })

  it('does not let a long filename change the height', () => {
    const short = estimateEntryRows(userEntry('hi', 1, 'a.png'), 40)
    const long = estimateEntryRows(userEntry('hi', 1, `${'a'.repeat(300)}.png`), 40)
    expect(long).toBe(short)
  })

  it('charges a hook run for its own row, and its stderr only when it has some', () => {
    // The header is drawn `truncate-end`, so neither the hook point, the
    // decision, nor a translation of either can make it wrap — its height is
    // one row at any width, which is what keeps paging invertible in both
    // languages. Only the stderr is charged by wrapping.
    const run = (stderrSummary?: string): UiEntry => ({
      kind: 'hook',
      handlerId: 'h',
      point: 'PreToolUse',
      dialect: 'claude-code',
      turn: 1,
      status: 'done',
      decision: 'deny',
      ...(stderrSummary !== undefined ? { stderrSummary } : {}),
    })
    expect(estimateEntryRows(run(), 80)).toBe(2)
    expect(estimateEntryRows(run(), 20)).toBe(2)
    expect(estimateEntryRows(run('short'), 80)).toBe(3)
  })

  it('does not let a blank stderr summary cost a hook run a row', () => {
    // `hookStderr` drops whitespace-only output. The estimator and the renderer
    // both go through it, so a hook that printed nothing but a newline is the
    // same height as one that printed nothing at all.
    const blank: UiEntry = {
      kind: 'hook',
      handlerId: 'h',
      point: 'Stop',
      dialect: 'codex',
      turn: 1,
      status: 'done',
      decision: 'pass',
      stderrSummary: '  \n ',
    }
    expect(estimateEntryRows(blank, 80)).toBe(2)
  })

  it('adds the metadata header an assistant turn carries', () => {    expect(estimateEntryRows(assistantEntry('hi'), 80)).toBe(3)
  })

  it('grows with wrapped text', () => {
    const short = estimateEntryRows(userEntry('a'.repeat(10)), 40)
    const long = estimateEntryRows(userEntry('a'.repeat(400)), 40)
    expect(long).toBeGreaterThan(short)
  })

  it('counts each hard line break', () => {
    // Separator, the frame's two rows, and one row per line.
    expect(estimateEntryRows(userEntry('a\nb\nc'), 80)).toBe(6)
  })

  it('charges a shell entry for its command, output and one status row', () => {
    const base = {
      kind: 'shell' as const,
      command: 'ls',
      output: 'a\nb',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      injected: false,
    }
    // Separator + `!ls` + two output rows, and nothing more: a command that
    // exited 0 with intact output has no status to report.
    expect(estimateEntryRows(base, 80)).toBe(4)
    // One status row, never more, however many things it has to say.
    expect(estimateEntryRows({ ...base, exitCode: 1 }, 80)).toBe(5)
    expect(estimateEntryRows({ ...base, exitCode: 1, truncated: true, injected: true }, 80)).toBe(5)
  })

  it('keeps a shell status row at one row however narrow the terminal', () => {
    // The renderer truncates it rather than wrapping precisely so this count
    // cannot depend on the width or on which catalog is loaded. If wrapping is
    // ever reintroduced there, paging stops being invertible.
    const entry = {
      kind: 'shell' as const,
      command: 'x',
      output: '',
      exitCode: 137,
      signal: 'SIGKILL',
      timedOut: true,
      truncated: true,
      injected: true,
    }
    expect(estimateEntryRows(entry, 80)).toBe(3)
    expect(estimateEntryRows(entry, 12)).toBe(3)
  })

  it('charges a pending tool call for its invocation line alone', () => {
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
    // Separator plus `bash(ls)` — the outcome row appears once there is one.
    expect(rows).toBe(2)
  })

  it('adds a row once the call has an outcome', () => {
    const base = {
      kind: 'tool',
      callId: CallId('call-1'),
      name: 'bash',
      args: '{"command":"ls"}',
      turn: 1,
      step: 1,
    } as const
    const ok = estimateEntryRows(
      {
        ...base,
        status: 'ok',
        result: createToolResultMessage({
          callId: CallId('call-1'),
          content: [{ type: 'text', text: 'a.ts' }],
          isError: false,
        }),
      },
      80,
    )
    expect(ok).toBe(3)
  })

  it('charges a multi-line result for its preview plus the withheld marker', () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const rows = estimateEntryRows(
      {
        kind: 'tool',
        callId: CallId('call-1'),
        name: 'bash',
        args: '{"command":"ls"}',
        turn: 1,
        step: 1,
        status: 'ok',
        result: createToolResultMessage({
          callId: CallId('call-1'),
          content: [{ type: 'text', text: long }],
          isError: false,
        }),
      },
      80,
    )
    // Separator, invocation, eight preview rows, one `… +12 lines`.
    expect(rows).toBe(2 + PREVIEW_MAX_LINES + 1)
  })

  it('keeps a long result the same height at any width, because every preview row truncates', () => {
    // The whole reason the preview is a line slice rather than wrapped text:
    // the count must not move when the terminal narrows, or paging stops
    // being invertible. The marker is language-dependent, the height is not.
    const entry = {
      kind: 'tool' as const,
      callId: CallId('call-1'),
      name: 'bash',
      args: '{"command":"ls"}',
      turn: 1,
      step: 1,
      status: 'ok' as const,
      result: createToolResultMessage({
        callId: CallId('call-1'),
        content: [{ type: 'text', text: 'a'.repeat(400) }],
        isError: false,
      }),
    }
    expect(estimateEntryRows(entry, 80)).toBe(3)
    expect(estimateEntryRows(entry, 12)).toBe(3)
  })

  it('caps a long shell output instead of charging every line of it', () => {
    const entry = {
      kind: 'shell' as const,
      command: 'seq 40',
      output: Array.from({ length: 40 }, (_, i) => String(i)).join('\n'),
      exitCode: 0,
      timedOut: false,
      truncated: false,
      injected: false,
    }
    // Separator, the command line, the capped preview, the marker. No status
    // row: a clean exit that was neither truncated nor injected says nothing.
    expect(estimateEntryRows(entry, 80)).toBe(2 + PREVIEW_MAX_LINES + 1)
    expect(estimateEntryRows(entry, 12)).toBe(2 + PREVIEW_MAX_LINES + 1)
  })

  it('charges the expanded budget when the toggle is on', () => {
    // 30 lines is over the collapsed cap and under the expanded one, so this
    // is the case where the two answers differ and neither is the raw count
    // by accident.
    const entry = {
      kind: 'shell' as const,
      command: 'seq 30',
      output: Array.from({ length: 30 }, (_, i) => String(i)).join('\n'),
      exitCode: 0,
      timedOut: false,
      truncated: false,
      injected: false,
    }
    expect(estimateEntryRows(entry, 80, false)).toBe(2 + PREVIEW_MAX_LINES + 1)
    // Separator, command, all 30 rows. No marker: nothing was withheld.
    expect(estimateEntryRows(entry, 80, true)).toBe(2 + 30)
  })

  it('still caps expanded output, so the mounted window stays bounded', () => {
    // `windowStart` keeps a minimum number of entries mounted regardless of
    // their height, so an uncapped preview is an unbounded number of Ink
    // nodes laid out every frame. The expanded budget is a bigger cap, not
    // the absence of one.
    const entry = {
      kind: 'shell' as const,
      command: 'seq 500',
      output: Array.from({ length: 500 }, (_, i) => String(i)).join('\n'),
      exitCode: 0,
      timedOut: false,
      truncated: false,
      injected: false,
    }
    expect(estimateEntryRows(entry, 80, true)).toBe(2 + EXPANDED_MAX_LINES + 1)
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

  it('mounts fewer entries when expanded, because each one is taller', () => {
    // The flag has to reach here too, not just the renderer: the window is
    // sized in rows, and expanding changes what a row budget buys.
    const entries = Array.from({ length: 200 }, () => ({
      kind: 'shell' as const,
      command: 'seq 30',
      output: Array.from({ length: 30 }, (_, i) => String(i)).join('\n'),
      exitCode: 0,
      timedOut: false,
      truncated: false,
      injected: false,
    }))
    const collapsed = windowStart(entries, 80, 200, 20, false)
    const expanded = windowStart(entries, 80, 200, 20, true)
    expect(expanded).toBeGreaterThan(collapsed)
  })
})
