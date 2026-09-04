/**
 * The `/sessions` listing. Both functions are fed hand-built values rather
 * than a persistence backend: the point of keeping them pure is that the
 * summarisation and the column arithmetic can be stated without a store on
 * disk, and the command's own wiring is asserted in `commands.spec.ts`.
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  formatSessions,
  summarizeLog,
  type SessionLabels,
  type SessionRow,
} from '../src/sessions.ts'
import { displayWidth } from '../src/width.ts'

/** A `user/message` event carrying `text`, from the human unless told otherwise. */
function said(text: string, kind = 'user'): SessionEvent {
  return {
    type: 'user/message',
    seq: 0,
    time: 0,
    data: createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind } as never,
    }),
  }
}

const LABELS: SessionLabels = {
  current: '(this one)',
  earlier: count => `… +${count} earlier`,
}

function row(over?: Partial<SessionRow>): SessionRow {
  return {
    id: SessionId('tui-aaaa'),
    // A fixed local wall-clock moment; the formatter renders local time, so
    // the test states the input in local time too rather than pinning a zone.
    createdAt: new Date(2026, 8, 5, 14, 2).getTime(),
    current: false,
    ...over,
  }
}

describe('summarizeLog', () => {
  it('takes the first thing the human asked', () => {
    expect(summarizeLog([said('first'), said('second')])).toBe('first')
  })

  it('skips injected context, which would otherwise summarise every session the same', () => {
    // A well-configured agent opens with plugin injections. Summarising those
    // would make every row read `<system-reminder>…`, which is the failure
    // this whole listing exists to avoid.
    expect(summarizeLog([said('<system-reminder>', 'plugin'), said('the real question')]))
      .toBe('the real question')
  })

  it('returns undefined when nothing human was ever said', () => {
    expect(summarizeLog([])).toBeUndefined()
    expect(summarizeLog([said('injected', 'plugin')])).toBeUndefined()
    expect(summarizeLog([said('   ')])).toBeUndefined()
  })

  it('flattens newlines, because the summary is one column of one row', () => {
    expect(summarizeLog([said('fix the\n\n  scroll  drift')])).toBe('fix the scroll drift')
  })

  it('cuts by display column, not character count', () => {
    // 40 Chinese characters are 80 columns wide. Cutting on `.length` would
    // let this row run to twice the budget and wrap, and a wrapped row breaks
    // the one-line-per-session shape the listing is built on.
    const long = '很'.repeat(60)
    const summary = summarizeLog([said(long)])
    expect(summary).toBeDefined()
    expect(summary?.endsWith('…')).toBe(true)
    expect(displayWidth(summary ?? '')).toBeLessThanOrEqual(40)
  })
})

describe('formatSessions', () => {
  it('marks the current session and keeps its summary', () => {
    // The current row is the one whose id the user is most likely to copy, so
    // replacing its text with the marker would hide what makes it findable.
    const out = formatSessions(
      [row({ current: true, summary: 'what I am doing now' })],
      0,
      LABELS,
    )
    expect(out).toContain('●')
    expect(out).toContain('what I am doing now')
    expect(out).toContain('(this one)')
  })

  it('abbreviates a real id, which is otherwise half the terminal', () => {
    const full = 'tui-9f3c1a2b-0000-4000-8000-000000000001'
    const out = formatSessions([row({ id: SessionId(full) })], 0, LABELS, '/home/q')
    expect(out).toContain('tui-9f3c1a2b')
    expect(out).not.toContain(full)
  })

  it('keeps the marker inside the first 80 columns of a worst-case row', () => {
    // A full row does not fit an 80-column terminal, and widening it further is
    // the wrong trade — the columns it would have to give up are the dated ones
    // that tell two sessions apart. What is guaranteed instead is the order of
    // loss: the summary tail goes first, and "you are here" survives the cut.
    const out = formatSessions(
      [
        row({
          id: SessionId('tui-9f3c1a2b-0000-4000-8000-000000000001'),
          cwd: '/home/q/Desktop/dsh-tui',
          current: true,
          summary: 'x'.repeat(32),
        }),
      ],
      0,
      LABELS,
      '/home/q',
    )
    const [first = ''] = out.split('\n')
    expect(first.slice(0, 80)).toContain('(this one)')
  })

  it('renders a missing summary as blank rather than the word undefined', () => {
    const out = formatSessions([row()], 0, LABELS)
    expect(out).not.toContain('undefined')
    expect(out).toContain('tui-aaaa')
  })

  it('shortens the cwd against $HOME the way a prompt does', () => {
    const out = formatSessions([row({ cwd: '/Users/x/code/app' })], 0, LABELS, '/Users/x')
    expect(out).toContain('~/code/app')
    expect(out).not.toContain('/Users/x/code')
  })

  it('leaves a path outside $HOME alone', () => {
    const out = formatSessions([row({ cwd: '/srv/app' })], 0, LABELS, '/Users/x')
    expect(out).toContain('/srv/app')
  })

  it('aligns the summary column past a CJK cwd', () => {
    // Padding on `.length` would leave the wide row's summary two columns
    // short of the other, which is visible as a ragged table.
    const out = formatSessions(
      [
        row({ id: SessionId('tui-aaaa'), cwd: '/w/项目', summary: 'A' }),
        row({ id: SessionId('tui-bbbb'), cwd: '/w/abcdef', summary: 'B' }),
      ],
      0,
      LABELS,
      undefined,
    )
    const [first = '', second = ''] = out.split('\n')
    // Measured in display columns, not UTF-16 indices: the whole point is that
    // the two rows differ in character count and agree on width.
    const columnOf = (line: string, mark: string): number =>
      displayWidth(line.slice(0, line.indexOf(mark)))
    expect(columnOf(first, 'A')).toBe(columnOf(second, 'B'))
  })

  it('adds a fold row for what the cap left out, and none when nothing was', () => {
    expect(formatSessions([row()], 3, LABELS)).toContain('… +3 earlier')
    expect(formatSessions([row()], 0, LABELS)).not.toContain('earlier')
  })

  it('leaves no trailing whitespace on a row whose summary is missing', () => {
    // Every row of a command's output is drawn `wrap="truncate"`; trailing
    // padding is width spent on nothing.
    const out = formatSessions([row({ cwd: '/w/a' })], 0, LABELS, undefined)
    expect(out).toBe(out.trimEnd())
  })
})
