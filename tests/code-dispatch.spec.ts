/**
 * Code Mode sub-calls in the transcript.
 *
 * `tool/code-dispatch-start` and `tool/code-dispatch` are the only trace a
 * `run_code` program leaves of what it actually did: both are log-only, so
 * `deriveMessages()` drops them and the model never re-reads them. The TUI's
 * own bundle patch mounts `code-runtime`, which means every assembly this
 * package ships can emit these — a projection that ignored them showed a
 * program that read four files and edited one as a single `run_code(…) ✓`.
 *
 * What is pinned here is the placement rather than the wording: a sub-call
 * hangs inside its parent entry, so it costs one row and cannot be mistaken by
 * `tool/result` for the call it should be closing.
 * @module @qiao-qyn/dsh-tui/tests/code-dispatch.spec
 */

import { describe, expect, it } from 'vitest'
import type { CallId, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { SubCall, UiEntry, UiState } from '../src/core/types.ts'
import { replay } from '../src/core/state.ts'
import { estimateEntryRows } from '../src/render/scroll.ts'
import { subCallErrorLine, subCallRows } from '../src/render/message-layout.ts'

const PARENT = 'call-1' as CallId
const SUB = 'call-1:code:1' as CallId

/** One session event, shaped the way the log stores it. */
function event(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as unknown as SessionEvent
}

/** The `run_code` call a program's dispatches hang under. */
function runCode(callId: CallId = PARENT): SessionEvent {
  return event('tool/call', {
    callId,
    name: 'run_code',
    arguments: '{"code":"await read(\'a.ts\')"}',
    turn: 1,
    step: 1,
  })
}

function start(over: Partial<{
  parentCallId: CallId
  subCallId: CallId
  name: string
  args: unknown
}> = {}): SessionEvent {
  return event('tool/code-dispatch-start', {
    rootCallId: PARENT,
    parentCallId: over.parentCallId ?? PARENT,
    subCallId: over.subCallId ?? SUB,
    name: over.name ?? 'Read',
    arguments: over.args ?? { file_path: 'src/render/scroll.ts' },
  })
}

function settle(over: Partial<{
  subCallId: CallId
  name: string
  isError: boolean
  content: ContentBlock[]
}> = {}): SessionEvent {
  return event('tool/code-dispatch', {
    rootCallId: PARENT,
    parentCallId: PARENT,
    subCallId: over.subCallId ?? SUB,
    name: over.name ?? 'Read',
    arguments: { file_path: 'src/render/scroll.ts' },
    isError: over.isError ?? false,
    content: over.content ?? [{ type: 'text', text: '545 lines' }],
  })
}

/** The projected `run_code` entry, which every case here is about. */
function parentOf(state: UiState): Extract<UiEntry, { kind: 'tool' }> {
  const entry = state.entries.find(e => e.kind === 'tool')
  if (entry?.kind !== 'tool') throw new Error('no tool entry projected')
  return entry
}

function subCallsOf(state: UiState): readonly SubCall[] {
  return parentOf(state).subCalls ?? []
}

describe('a Code Mode sub-call', () => {
  it('hangs inside the run_code entry rather than becoming one of its own', () => {
    const state = replay([runCode(), start(), settle()])

    // One entry, not three: the sub-call is part of what `run_code` did.
    expect(state.entries).toHaveLength(1)
    expect(subCallsOf(state)).toHaveLength(1)
  })

  it('opens running and settles with the outcome the bridge reported', () => {
    const open = replay([runCode(), start()])
    expect(subCallsOf(open)[0]?.status).toBe('running')

    const done = replay([runCode(), start(), settle()])
    expect(subCallsOf(done)[0]?.status).toBe('ok')

    const failed = replay([runCode(), start(), settle({ isError: true })])
    expect(subCallsOf(failed)[0]?.status).toBe('error')
  })

  it('re-serializes the dispatched arguments so one summary draws both kinds', () => {
    const state = replay([runCode(), start()])

    // `tool/call` carries a JSON string and a dispatch carries the parsed
    // value; the layout layer only ever sees the string form.
    expect(subCallsOf(state)[0]?.args).toBe('{"file_path":"src/render/scroll.ts"}')
  })

  it('keeps the parent the one running tool, so tool/result still closes it', () => {
    // The regression this guards: with sub-calls as entries of their own,
    // `tool/result`'s "close the most recent running tool" would have closed
    // the sub-call and left `run_code` spinning forever.
    const state = replay([
      runCode(),
      start(),
      settle(),
      event('tool/result', {
        message: { role: 'user', content: [{ type: 'text', text: 'done' }] },
      }),
    ])

    expect(parentOf(state).status).toBe('ok')
  })

  it('pairs by subCallId, not by recency', () => {
    const second = 'call-1:code:2' as CallId
    const state = replay([
      runCode(),
      start(),
      start({ subCallId: second, name: 'Grep' }),
      // The *older* of the two open dispatches settles first.
      settle(),
    ])

    const subs = subCallsOf(state)
    expect(subs.map(c => c.status)).toEqual(['ok', 'running'])
    expect(subs.map(c => c.name)).toEqual(['Read', 'Grep'])
  })

  it('drops a dispatch whose run_code is not on screen', () => {
    // A bare `Read(…)` row with no program above it reads as a call the model
    // made directly, which is the one thing it is not.
    const state = replay([start(), settle()])

    expect(state.entries).toHaveLength(0)
  })

  it('records a settlement whose start was never projected', () => {
    // A projection joining mid-program has the settlement and not the start.
    // The settlement carries the whole call, so showing it beats dropping it.
    const state = replay([runCode(), settle()])

    expect(subCallsOf(state)).toMatchObject([{ name: 'Read', status: 'ok' }])
  })

  it('inherits the parent fate when the turn ends with it still open', () => {
    const ended = (reason: TurnEndReason): SubCall | undefined =>
      subCallsOf(replay([runCode(), start(), event('turn/end', { turn: 1, reason })]))[0]

    expect(ended({ kind: 'interrupted' })?.status).toBe('cancelled')
    expect(ended({ kind: 'completed' })?.status).toBe('ok')
  })
})

describe('the rows a sub-call is charged', () => {
  const sub = (over: Partial<SubCall> = {}): SubCall => ({
    subCallId: SUB,
    name: 'Read',
    args: '{"file_path":"src/render/scroll.ts"}',
    status: 'ok',
    ...over,
  })

  it('is one, whatever the output came to', () => {
    const long = [{ type: 'text' as const, text: 'x\n'.repeat(400) }]
    expect(subCallRows(sub())).toBe(1)
    expect(subCallRows(sub({ content: long }))).toBe(1)
  })

  it('is two for a failure, because that text is nowhere else', () => {
    const failed = sub({
      status: 'error',
      content: [{ type: 'text', text: 'ENOENT: no such file\nat read()' }],
    })
    expect(subCallRows(failed)).toBe(2)
    expect(subCallErrorLine(failed)).toBe('ENOENT: no such file')
  })

  it('is one for a failure that said nothing', () => {
    expect(subCallRows(sub({ status: 'error', content: [] }))).toBe(1)
  })

  it('adds those rows to the parent entry the renderer draws them in', () => {
    const state = replay([runCode(), start(), settle()])
    const bare = replay([runCode()])

    // Exactly one row more than the same call with no program inside it, at
    // any width — both sub-call rows are drawn truncated.
    for (const columns of [40, 80, 200]) {
      expect(estimateEntryRows(parentOf(state), columns))
        .toBe(estimateEntryRows(parentOf(bare), columns) + 1)
    }
  })
})
