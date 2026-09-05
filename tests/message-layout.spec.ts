/**
 * Tests for the conversation surface's pure layout decisions.
 *
 * These cover the strings the transcript is built from — a tool call's label,
 * a result's one-line summary — without mounting Ink. `scroll.ts` measures
 * these same strings to decide how much history to keep mounted, so a change
 * that makes one of them taller than expected is a scrolling bug as much as a
 * cosmetic one.
 * @module
 */

import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  EXPANDED_MAX_LINES,
  approvalArgs,
  GUTTER_WIDTH,
  PREVIEW_MAX_LINES,
  outputPreview,
  previewLimit,
  previewRows,
  toolCallSummary,
  toolResultPreview,
  toolStatusGlyph,
  truncate,
} from '../src/message-layout.ts'

describe('truncate', () => {
  it('leaves text that already fits', () => {
    expect(truncate('abc', 3)).toBe('abc')
  })

  it('never exceeds the budget it was given', () => {
    // The ellipsis has to fit *inside* max, not past it — the gutter leaves no
    // spare columns to absorb an off-by-one.
    expect(truncate('abcdef', 4)).toBe('abc…')
    expect(truncate('abcdef', 4)).toHaveLength(4)
  })
})

describe('toolCallSummary', () => {
  it('reads as name(subject)', () => {
    expect(toolCallSummary('Read', '{"file_path":"src/scroll.ts"}'))
      .toBe('Read(src/scroll.ts)')
  })

  it('prefers the conventional subject key over declaration order', () => {
    // `description` comes first in the payload, but the command is what
    // distinguishes one Bash call from another.
    expect(toolCallSummary('Bash', '{"description":"run the tests","command":"pnpm test"}'))
      .toBe('Bash(pnpm test)')
  })

  it('falls back to the first string argument when no key is conventional', () => {
    expect(toolCallSummary('Weird', '{"count":3,"whatever":"hello"}'))
      .toBe('Weird(hello)')
  })

  it('shows the tool name alone when there is no subject to show', () => {
    expect(toolCallSummary('Ls', '')).toBe('Ls')
    expect(toolCallSummary('Ls', '   ')).toBe('Ls')
    expect(toolCallSummary('Ls', '{}')).toBe('Ls')
    expect(toolCallSummary('Ls', '{"recursive":true}')).toBe('Ls')
    expect(toolCallSummary('Ls', '{"path":"  "}')).toBe('Ls')
  })

  it('degrades instead of throwing on a payload that is not JSON', () => {
    // Arguments arrive as whatever the model emitted; a truncated stream is a
    // display problem, not a crash.
    expect(toolCallSummary('Read', '{"file_path":"src/scr')).toBe('Read({"file_path":"src/scr)')
  })

  it('collapses a multi-line argument onto one row', () => {
    expect(toolCallSummary('Bash', JSON.stringify({ command: 'a\nb\n  c' })))
      .toBe('Bash(a b c)')
  })

  it('keeps a long subject inside one row of a narrow terminal', () => {
    const long = toolCallSummary('Read', JSON.stringify({ file_path: 'x'.repeat(200) }))
    expect(long.length).toBeLessThan(80 - GUTTER_WIDTH)
    expect(long.endsWith('…)')).toBe(true)
  })
})

/**
 * A result message shaped the way the tool loop actually produces one: the
 * payload sits inside a `tool-result` block, not in the message's own content
 * array. Building it through the real factory is the point — a hand-rolled
 * flat array is what let the nesting bug hide.
 */
function toolResult(...blocks: ContentBlock[]) {
  return createToolResultMessage({
    callId: CallId('call-1'),
    content: blocks,
    isError: false,
  })
}

const text = (value: string): ContentBlock => ({ type: 'text', text: value })

describe('toolResultPreview', () => {
  it('reaches the text inside the tool-result block', () => {
    expect(toolResultPreview(toolResult(text('226 passed'))))
      .toEqual({ lines: ['226 passed'], hidden: 0 })
  })

  it('shows a multi-line result instead of only its first line', () => {
    // The whole point of the change: three files came back, and the transcript
    // says so. This used to read `a.ts (+2 more)`.
    expect(toolResultPreview(toolResult(text('a.ts\nb.ts\nc.ts'))))
      .toEqual({ lines: ['a.ts', 'b.ts', 'c.ts'], hidden: 0 })
  })

  it('withholds what does not fit and counts it', () => {
    const lines = Array.from({ length: PREVIEW_MAX_LINES + 5 }, (_, i) => `line ${i}`)
    const preview = toolResultPreview(toolResult(text(lines.join('\n'))))
    expect(preview.lines).toHaveLength(PREVIEW_MAX_LINES)
    expect(preview.lines[0]).toBe('line 0')
    expect(preview.hidden).toBe(5)
  })

  it('does not count blank lines as withheld content', () => {
    // A trailing newline is nearly universal in command output; charging it as
    // a hidden line would claim there is something else to see.
    expect(toolResultPreview(toolResult(text('done\n'))))
      .toEqual({ lines: ['done'], hidden: 0 })
  })

  it('drops blocks a terminal cannot render', () => {
    // An image block's bytes live behind an attachment ref the preview never
    // touches, so an empty stand-in is enough to prove it is skipped.
    const image = { type: 'image', attachment: {} } as ContentBlock
    expect(toolResultPreview(toolResult(image, text('ok'))).lines).toEqual(['ok'])
    expect(toolResultPreview(toolResult(image)).lines).toEqual([])
    expect(toolResultPreview(toolResult()).lines).toEqual([])
  })
})

describe('outputPreview', () => {
  it('keeps indentation, because code output is mostly indentation', () => {
    expect(outputPreview('function f() {\n  return 1\n}').lines)
      .toEqual(['function f() {', '  return 1', '}'])
  })

  it('trims trailing whitespace, which a truncated row would spend width on', () => {
    expect(outputPreview('ok   \tmore  ').lines).toEqual(['ok   \tmore'])
  })

  it('treats a whitespace-only line as blank', () => {
    expect(outputPreview('a\n   \nb').lines).toEqual(['a', 'b'])
  })

  it('never returns zero rows for a non-empty limit', () => {
    // `Math.max(1, …)` guards the caller who passes 0; a preview of nothing
    // with a `hidden` count would be a row of pure marker.
    expect(outputPreview('a\nb\nc', 0)).toEqual({ lines: ['a'], hidden: 2 })
  })

  it('says nothing at all about an empty output', () => {
    expect(outputPreview('')).toEqual({ lines: [], hidden: 0 })
  })
})

describe('previewLimit', () => {
  it('gives the collapsed budget by default and the raised one when expanded', () => {
    expect(previewLimit(false)).toBe(PREVIEW_MAX_LINES)
    expect(previewLimit(true)).toBe(EXPANDED_MAX_LINES)
  })

  it('stays finite when expanded, so the mounted window has a ceiling', () => {
    // Not `Infinity`: the scroll window keeps a minimum number of entries
    // mounted whatever they cost, so an uncapped preview is an uncapped
    // number of Ink nodes laid out every frame.
    expect(Number.isFinite(EXPANDED_MAX_LINES)).toBe(true)
    expect(EXPANDED_MAX_LINES).toBeGreaterThan(PREVIEW_MAX_LINES)
  })

  it('withholds nothing under the raised budget and still counts what it withholds over it', () => {
    const under = Array.from({ length: EXPANDED_MAX_LINES }, (_, i) => `l${i}`).join('\n')
    expect(outputPreview(under, previewLimit(true)).hidden).toBe(0)
    const over = `${under}\nl-extra`
    expect(outputPreview(over, previewLimit(true)))
      .toEqual({ lines: under.split('\n'), hidden: 1 })
  })
})

describe('previewRows', () => {
  it('charges one row per line and one for the marker', () => {
    expect(previewRows({ lines: ['a', 'b'], hidden: 0 })).toBe(2)
    expect(previewRows({ lines: ['a', 'b'], hidden: 7 })).toBe(3)
    expect(previewRows({ lines: [], hidden: 0 })).toBe(0)
  })

  it('does not depend on the width of the lines', () => {
    // The renderer draws every preview row `wrap="truncate"`. If that ever
    // changes, this expectation is the one that should fail first.
    const wide = { lines: ['x'.repeat(500)], hidden: 0 }
    expect(previewRows(wide)).toBe(1)
  })
})

describe('toolStatusGlyph', () => {
  it('gives each status its own mark', () => {
    const glyphs = (['running', 'ok', 'error'] as const).map(toolStatusGlyph)
    expect(new Set(glyphs).size).toBe(glyphs.length)
    for (const glyph of glyphs) expect(glyph).toHaveLength(1)
  })
})

/**
 * `approvalArgs` answers a different question from `toolCallSummary`, and the
 * difference is the point: the summary identifies a call among many, this one
 * describes a call the user is about to authorise. Whichever argument the
 * summary drops is exactly the one that could make the call something other
 * than it looks like.
 */
describe('approvalArgs', () => {
  it('lists every top-level key, including the ones the summary drops', () => {
    const args = JSON.stringify({ command: 'rm -rf ./build', timeout: 5000 })

    expect(toolCallSummary('Bash', args)).toBe('Bash(rm -rf ./build)')
    expect(approvalArgs(args).rows).toEqual([
      { key: 'command', value: 'rm -rf ./build' },
      { key: 'timeout', value: '5000' },
    ])
  })

  it('has nothing to say about an empty payload', () => {
    expect(approvalArgs('')).toEqual({ rows: [], hidden: 0 })
    expect(approvalArgs('   ')).toEqual({ rows: [], hidden: 0 })
  })

  it('shows malformed JSON raw rather than showing nothing', () => {
    // A model that fumbled the schema is still describing a call somebody has
    // to decide about.
    const { rows, hidden } = approvalArgs('{"command": "rm -rf ./bui')

    expect(hidden).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('')
    expect(rows[0]?.value).toContain('rm -rf ./bui')
  })

  it('re-serialises a nested value instead of printing [object Object]', () => {
    const { rows } = approvalArgs(JSON.stringify({ edits: [{ old: 'a', new: 'b' }] }))

    expect(rows[0]?.value).toBe('[{"old":"a","new":"b"}]')
  })

  it('collapses a multi-line value onto its own single row', () => {
    const { rows } = approvalArgs(JSON.stringify({ content: 'line one\nline two' }))

    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toBe('line one line two')
  })

  it('counts the arguments it leaves out', () => {
    const args = JSON.stringify({ a: '1', b: '2', c: '3', d: '4' })
    const { rows, hidden } = approvalArgs(args, 2)

    expect(rows.map(r => r.key)).toEqual(['a', 'b'])
    expect(hidden).toBe(2)
  })

  it('truncates a long value but keeps far more of it than the summary does', () => {
    const command = 'x'.repeat(400)
    const args = JSON.stringify({ command })

    const summary = toolCallSummary('Bash', args)
    const row = approvalArgs(args).rows[0]?.value ?? ''
    expect(row.length).toBeGreaterThan(summary.length)
    expect(row.endsWith('…')).toBe(true)
  })
})
