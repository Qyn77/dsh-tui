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
  GUTTER_WIDTH,
  toolCallSummary,
  toolResultSummary,
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

describe('toolResultSummary', () => {
  it('reaches the text inside the tool-result block', () => {
    expect(toolResultSummary(toolResult(text('226 passed')))).toBe('226 passed')
  })

  it('abridges a multi-line result with the count it withheld', () => {
    expect(toolResultSummary(toolResult(text('a.ts\nb.ts\nc.ts'))))
      .toBe('a.ts (+2 more)')
  })

  it('does not count blank lines as withheld content', () => {
    // A trailing newline is nearly universal in command output; charging it as
    // `(+1 more)` would claim there is something else to see.
    expect(toolResultSummary(toolResult(text('done\n')))).toBe('done')
  })

  it('drops blocks a terminal cannot render', () => {
    // An image block's bytes live behind an attachment ref the summary never
    // touches, so an empty stand-in is enough to prove it is skipped.
    const image = { type: 'image', attachment: {} } as ContentBlock
    expect(toolResultSummary(toolResult(image, text('ok')))).toBe('ok')
    expect(toolResultSummary(toolResult(image))).toBe('')
    expect(toolResultSummary(toolResult())).toBe('')
  })
})

describe('toolStatusGlyph', () => {
  it('gives each status its own mark', () => {
    const glyphs = (['running', 'ok', 'error'] as const).map(toolStatusGlyph)
    expect(new Set(glyphs).size).toBe(glyphs.length)
    for (const glyph of glyphs) expect(glyph).toHaveLength(1)
  })
})
