/**
 * Pure-parse tests for the markdown AST. No Ink, no React, no I/O —
 * these pin the contract that the renderer relies on.
 */

import { describe, expect, it } from 'vitest'
import { looksLikeMarkdown, parseMarkdown, type BlockNode, type InlineNode } from '../src/markdown.ts'

/** Flatten an inline AST into one string for shape assertions. */
function inlineToText(nodes: readonly InlineNode[]): string {
  return nodes.map(nodeToText).join('')
}

function nodeToText(node: InlineNode): string {
  switch (node.kind) {
    case 'text':
      return node.text
    case 'code':
      return node.text
    case 'bold':
    case 'italic':
    case 'link':
      return inlineToText(node.children)
  }
}

function findBlock<T extends BlockNode['kind']>(blocks: BlockNode[], kind: T): Extract<BlockNode, { kind: T }> | undefined {
  return blocks.find((b): b is Extract<BlockNode, { kind: T }> => b.kind === kind)
}

describe('parseMarkdown', () => {
  it('returns an empty list for empty input', () => {
    expect(parseMarkdown('')).toEqual([])
  })

  it('treats plain text as one paragraph', () => {
    const blocks = parseMarkdown('hello world')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'paragraph' })
    if (blocks[0]?.kind === 'paragraph') {
      expect(inlineToText(blocks[0].children)).toBe('hello world')
    }
  })

  it('parses headings with the right level', () => {
    const blocks = parseMarkdown('# H1\n\n## H2\n\n###### H6')
    const headings = blocks.filter((b) => b.kind === 'heading')
    expect(headings).toHaveLength(3)
    expect(headings[0]).toMatchObject({ kind: 'heading', level: 1 })
    expect(headings[1]).toMatchObject({ kind: 'heading', level: 2 })
    expect(headings[2]).toMatchObject({ kind: 'heading', level: 6 })
  })

  it('parses fenced code blocks and remembers the language', () => {
    const blocks = parseMarkdown('```ts\nconst x = 1\n```')
    const code = findBlock(blocks, 'code-block')
    expect(code).toBeDefined()
    if (code?.kind === 'code-block') {
      expect(code.lang).toBe('ts')
      expect(code.text).toBe('const x = 1')
    }
  })

  it('parses a fenced code block with no language', () => {
    const blocks = parseMarkdown('```\nplain\n```')
    const code = findBlock(blocks, 'code-block')
    expect(code?.kind === 'code-block' && code.lang).toBe('')
  })

  it('parses bold and italic inline', () => {
    const blocks = parseMarkdown('a **bold** and *italic* word')
    const p = findBlock(blocks, 'paragraph')
    expect(p?.kind === 'paragraph' && p.children).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', children: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'italic' }] },
      { kind: 'text', text: ' word' },
    ])
  })

  it('parses inline code', () => {
    const blocks = parseMarkdown('use `npm install` first')
    const p = findBlock(blocks, 'paragraph')
    expect(p?.kind === 'paragraph' && p.children).toEqual([
      { kind: 'text', text: 'use ' },
      { kind: 'code', text: 'npm install' },
      { kind: 'text', text: ' first' },
    ])
  })

  it('renders link children as the URL only (no anchor label)', () => {
    const blocks = parseMarkdown('[docs](https://example.com)')
    const p = findBlock(blocks, 'paragraph')
    expect(p?.kind === 'paragraph' && p.children).toEqual([
      { kind: 'link', href: 'https://example.com', children: [{ kind: 'text', text: 'https://example.com' }] },
    ])
  })

  it('parses an unordered list with bullet markers', () => {
    const blocks = parseMarkdown('- one\n- two\n- three')
    const list = findBlock(blocks, 'list')
    expect(list?.kind === 'list' && list.ordered).toBe(false)
    if (list?.kind === 'list') {
      expect(list.items).toHaveLength(3)
      expect(list.items.map((c) => inlineToText(c))).toEqual(['one', 'two', 'three'])
    }
  })

  it('parses an ordered list', () => {
    const blocks = parseMarkdown('1. first\n2. second')
    const list = findBlock(blocks, 'list')
    expect(list?.kind === 'list' && list.ordered).toBe(true)
    if (list?.kind === 'list') {
      expect(list.items).toHaveLength(2)
    }
  })

  it('parses a blockquote as one paragraph with the leading `> ` stripped', () => {
    const blocks = parseMarkdown('> quoted line\n> second line')
    const quote = findBlock(blocks, 'blockquote')
    expect(quote?.kind === 'blockquote' && inlineToText(quote.children)).toContain('quoted line')
    if (quote?.kind === 'blockquote') {
      // The two source lines should appear, joined.
      expect(inlineToText(quote.children)).toMatch(/quoted line.*second line/s)
    }
  })

  it('parses a thematic break from `---`', () => {
    const blocks = parseMarkdown('above\n\n---\n\nbelow')
    expect(blocks.some((b) => b.kind === 'thematic-break')).toBe(true)
  })

  it('handles a multi-block document in order', () => {
    const md = '# Title\n\nintro\n\n```js\nx\n```\n\n- a\n- b'
    const blocks = parseMarkdown(md)
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading', 'paragraph', 'code-block', 'list',
    ])
  })

  it('falls back to a single paragraph on unclosed fence (no throw)', () => {
    const blocks = parseMarkdown('```ts\nconst x = 1')
    // Either marked closes the fence (yields a code-block) or we fall
    // back; both are acceptable. The contract is: never throw, never
    // return empty.
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks[0]?.kind === 'paragraph' || blocks[0]?.kind === 'code-block').toBe(true)
  })

  it('falls back to a single paragraph on a stray asterisk (no throw)', () => {
    const blocks = parseMarkdown('hello * world')
    expect(blocks.length).toBeGreaterThan(0)
  })

  it('strips raw HTML instead of passing it through', () => {
    const blocks = parseMarkdown('safe <script>alert(1)</script> end')
    const all = JSON.stringify(blocks)
    expect(all).not.toMatch(/<script>/i)
    expect(all).toContain('safe')
    expect(all).toContain('end')
  })
})

describe('looksLikeMarkdown', () => {
  it('returns false for empty or plain prose', () => {
    expect(looksLikeMarkdown('')).toBe(false)
    expect(looksLikeMarkdown('hello world')).toBe(false)
    expect(looksLikeMarkdown('just a sentence. with two.')).toBe(false)
  })

  it('detects a heading opener', () => {
    expect(looksLikeMarkdown('# title')).toBe(true)
    expect(looksLikeMarkdown('intro\n## section')).toBe(true)
  })

  it('detects a fenced code block', () => {
    expect(looksLikeMarkdown('```ts\nx\n```')).toBe(true)
  })

  it('detects a list or blockquote opener', () => {
    expect(looksLikeMarkdown('- item')).toBe(true)
    expect(looksLikeMarkdown('1. first')).toBe(true)
    expect(looksLikeMarkdown('> quote')).toBe(true)
  })

  it('detects a thematic break', () => {
    expect(looksLikeMarkdown('a\n\n---\n\nb')).toBe(true)
  })
})
