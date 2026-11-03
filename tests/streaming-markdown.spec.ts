/**
 * Markdown is drawn from the first delta, not from the finalization event.
 *
 * These are frame tests because the change is entirely about what the reader
 * sees *while* the answer arrives. `markdown.spec.ts` already proves the parse
 * is stable across prefixes; what it cannot show is that the composed frame
 * carries a rendered heading instead of a literal `##`, and that sealing the
 * turn afterwards moves nothing.
 * @module @qiao-qyn/dsh-tui/tests/streaming-markdown.spec
 */

import { LlmAttemptId } from '@deepseek-ai/dsh-llm'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { paintApp, type Painted } from './fake-tty.ts'

let painted: Painted | undefined

afterEach(() => {
  painted?.unmount()
  painted = undefined
})

/** The frame's rows, blanks dropped — what the reader can actually point at. */
function rows(app: Painted): string[] {
  return app.screen().split('\n').map(line => line.trimEnd()).filter(line => line !== '')
}

/** The answer's rows: the assistant header, then everything under it. */
function body(app: Painted): string[] {
  const lines = rows(app)
  const header = lines.findIndex(line => line.includes('assistant'))
  expect(header).toBeGreaterThanOrEqual(0)
  return lines.slice(header)
}

describe('streaming markdown', () => {
  it('renders a heading as a heading before the turn is sealed', async () => {
    painted = await paintApp({ rows: 40 })
    await painted.stream('## Result\n\nit worked')
    const screen = painted.screen()
    expect(screen).toContain('streaming')
    expect(screen).toContain('Result')
    expect(screen).not.toContain('## Result')
  })

  it('draws a code frame from the opening fence, before the closer arrives', async () => {
    painted = await paintApp({ rows: 40 })
    await painted.stream('run this:\n\n```ts\nconst x = 1')
    const screen = painted.screen()
    // The rounded border is the code block's own frame; a raw-text stream
    // would have shown three backticks and no box.
    expect(screen).toContain('╭')
    expect(screen).toContain('const x = 1')
    expect(screen).not.toContain('```')
  })

  it('does not reflow the answer when the turn finalizes', async () => {
    // The defect this whole change removes: the body was raw text for the
    // length of the answer and re-laid-out as markdown at the exact moment
    // the reader started reading it. Every row below the header has to be
    // identical across the seal.
    const answer = '## Done\n\nThe **fix** is in `parse`.\n\n- one\n- two'
    painted = await paintApp({ rows: 40 })
    await painted.stream(answer)
    const streaming = body(painted)
    await painted.finalize(answer)
    const sealed = body(painted)
    // The header row is the one row that is meant to change: it loses the
    // streaming marker. Everything after it is the answer itself.
    expect(streaming[0]).toContain('streaming')
    expect(sealed[0]).not.toContain('streaming')
    expect(sealed.slice(1)).toEqual(streaming.slice(1))
  })

  it('accumulates deltas into one block that grows in place', async () => {
    painted = await paintApp({ rows: 40 })
    await painted.stream('The ')
    await painted.stream('**fix**')
    await painted.stream(' landed')
    const screen = painted.screen()
    expect(screen).toContain('The fix landed')
    // One assistant entry, not three: the deltas share a (turn, step).
    expect(screen.match(/assistant/g)).toHaveLength(1)
  })

  it('discards abandoned text and ignores delayed chunks from an earlier attempt', async () => {
    const app = painted = await paintApp({ rows: 40 })
    const send = async (frame: AssistantStreamFrame): Promise<void> => {
      app.ctx.emit('agent/assistant-stream', { agent: app.agent as Agent, frame })
      await app.settle()
    }
    const first = LlmAttemptId('first')
    const retry = LlmAttemptId('retry')
    await send({ type: 'start', revision: 1, attemptId: first, turn: 1, step: 1 })
    await send({ type: 'chunk', revision: 2, attemptId: first, index: 0, time: 0,
      chunk: { type: 'text-delta', index: 0, text: 'discard me' } })
    expect(app.screen()).toContain('discard me')
    await send({ type: 'end', revision: 3, attemptId: first, index: 1, outcome: { kind: 'abandoned' } })
    await send({ type: 'start', revision: 4, attemptId: retry, turn: 1, step: 1 })
    await send({ type: 'chunk', revision: 2, attemptId: first, index: 0, time: 0,
      chunk: { type: 'text-delta', index: 0, text: 'discard me' } })
    await send({ type: 'chunk', revision: 5, attemptId: retry, index: 0, time: 1,
      chunk: { type: 'text-delta', index: 0, text: 'kept answer' } })
    await app.finalize('kept answer')
    expect(app.screen()).not.toContain('discard me')
    expect(app.screen().match(/kept answer/g)).toHaveLength(1)
  })

  it('keeps a row for a turn that has announced itself with no text yet', async () => {
    // `parseMarkdown('')` is an empty document. Without the placeholder the
    // block collapses to its header for the width of one delta.
    painted = await paintApp({ rows: 40 })
    await painted.stream('')
    expect(painted.screen()).toContain('streaming')
  })
})
