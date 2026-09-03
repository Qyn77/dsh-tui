/**
 * Pure-parse tests for the markdown AST. No Ink, no React, no I/O —
 * these pin the contract that the renderer relies on.
 */

import { describe, expect, it } from 'vitest'
import { applyHangingIndent, looksLikeMarkdown, parseMarkdown, stripIndentOutsideFences, stripLeadingIndent, type BlockNode, type InlineNode } from '../src/markdown.ts'

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
    const headings = blocks.filter(b => b.kind === 'heading')
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
      expect(list.items.map(c => inlineToText(c))).toEqual(['one', 'two', 'three'])
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
    expect(blocks.some(b => b.kind === 'thematic-break')).toBe(true)
  })

  it('handles a multi-block document in order', () => {
    const md = '# Title\n\nintro\n\n```js\nx\n```\n\n- a\n- b'
    const blocks = parseMarkdown(md)
    expect(blocks.map(b => b.kind)).toEqual([
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

  it('strips 1–4 leading spaces from a paragraph continuation line (lyrics-style)', () => {
    // Common case: model writes "line 1\n  line 2" hoping the second
    // line is indented visually. In the terminal, that reads as a
    // right-shifted continuation. The parser flattens the indent.
    const blocks = parseMarkdown('line 1\n  line 2')
    expect(blocks).toHaveLength(1)
    const p = findBlock(blocks, 'paragraph')
    expect(p?.kind === 'paragraph' && inlineToText(p.children)).toBe('line 1\nline 2')
  })

  it('leaves a single-line paragraph unchanged', () => {
    const blocks = parseMarkdown('hello world')
    const p = findBlock(blocks, 'paragraph')
    expect(p?.kind === 'paragraph' && inlineToText(p.children)).toBe('hello world')
  })

  it('strips all leading spaces from a paragraph continuation line, no cap', () => {
    // The model regularly indents lyrics / dialog by 10+ spaces.
    // 4-space "code block threshold" reasoning does not apply here
    // — marked keeps these continuations as paragraph text. So
    // strip everything, not just 1–4.
    const blocks = parseMarkdown('line 1\n               line 2')
    expect(blocks).toHaveLength(1)
    const p = findBlock(blocks, 'paragraph')
    expect(p?.kind === 'paragraph' && inlineToText(p.children)).toBe('line 1\nline 2')
  })

  it('pre-strips blank-line-separated indented blocks so they stay paragraphs, not code blocks', () => {
    // Without pre-strip, marked promotes blank-line-separated
    // 4+-space-indented lines to a `code` block — the post-parse
    // text-node strip never sees them, so the indent survives
    // and the renderer frames the lyrics in a `╭─╮` box. Pre-strip
    // at the parse boundary demotes them back to plain paragraphs.
    const blocks = parseMarkdown('（Verse 1）\n\n              屏幕的光\n\n              凌晨三点')
    expect(blocks.filter(b => b.kind === 'code-block')).toHaveLength(0)
    const paragraphs = blocks.filter(b => b.kind === 'paragraph')
    expect(paragraphs).toHaveLength(3)
    expect(paragraphs.map(p => inlineToText(p.kind === 'paragraph' ? p.children : [])))
      .toEqual(['（Verse 1）', '屏幕的光', '凌晨三点'])
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

describe('stripLeadingIndent', () => {
  it('is a no-op on a string with no newlines or after-newline spaces', () => {
    expect(stripLeadingIndent('hello world')).toBe('hello world')
    expect(stripLeadingIndent('a\nb\nc')).toBe('a\nb\nc')
  })

  it('leaves leading spaces at the start of the string alone', () => {
    // Start-of-string spaces are load-bearing separators (e.g. the
    // space between `**bold**` and the next word). They must not be
    // stripped — only continuation lines after `\n` are.
    expect(stripLeadingIndent('  indented')).toBe('  indented')
    expect(stripLeadingIndent('    four spaces')).toBe('    four spaces')
  })

  it('strips 1–4 spaces after each newline (paragraph continuations)', () => {
    expect(stripLeadingIndent('a\n  b')).toBe('a\nb')
    expect(stripLeadingIndent('a\n   b\n    c')).toBe('a\nb\nc')
  })

  it('strips all leading spaces, no matter how deep (lyrics-style)', () => {
    // 10-space, 15-space, mixed tabs: all go. The model regularly
    // indents lyrics 10+ spaces; we don't need to preserve any of
    // that visual depth in the terminal.
    expect(stripLeadingIndent('a\n          b')).toBe('a\nb')
    expect(stripLeadingIndent('a\n                 b')).toBe('a\nb')
    expect(stripLeadingIndent('a\n \t  b')).toBe('a\nb')
  })

  it('preserves consecutive newlines (blank lines stay blank)', () => {
    expect(stripLeadingIndent('a\n\nb')).toBe('a\n\nb')
    expect(stripLeadingIndent('a\n   \nb')).toBe('a\n\nb')
  })

  it('does not strip interior spaces in the middle of a line', () => {
    expect(stripLeadingIndent('a   b')).toBe('a   b')
  })
})

describe('applyHangingIndent', () => {
  it('inserts 2 spaces after each soft line break (newline not followed by another newline)', () => {
    expect(applyHangingIndent('line 1\nline 2')).toBe('line 1\n  line 2')
    expect(applyHangingIndent('a\nb\nc')).toBe('a\n  b\n  c')
  })

  it('preserves the blank line itself (no 2 spaces inserted onto the empty line) and indents the line after', () => {
    // `a\n\nb` is "a" / blank / "b". The empty middle line must stay
    // empty (no `   \n` in the output); the "b" line after the
    // blank gets the 2-space indent.
    expect(applyHangingIndent('a\n\nb')).toBe('a\n\n  b')
    expect(applyHangingIndent('a\n\n\nb')).toBe('a\n\n\n  b')
  })

  it('is a no-op on text with no newlines', () => {
    expect(applyHangingIndent('hello world')).toBe('hello world')
    expect(applyHangingIndent('')).toBe('')
  })

  it('handles a leading newline (first line is itself a continuation)', () => {
    // Model quirk: a stray `\n` at the start of a text node still
    // gets a 2-space indent on what follows. Empty leading line is
    // rare in practice, but the transform should not throw on it.
    expect(applyHangingIndent('\nfoo')).toBe('\n  foo')
  })
})

/**
 * Streaming renders every prefix of an answer, not just the finished text.
 *
 * The old streaming rule held the raw text until finalization because a partial
 * document was assumed to parse into something unstable. These pin the opposite:
 * the intermediate parses are boring, and the one construct that could have
 * moved the layout under the reader — a code fence — is already in its final
 * shape the moment its opener arrives.
 */
describe('partial input (streaming)', () => {
  /** Every prefix of `text`, from one character to the whole thing. */
  function prefixes(text: string): string[] {
    return Array.from({ length: text.length }, (_, index) => text.slice(0, index + 1))
  }

  const answer = [
    '## Result',
    '',
    'The **fix** is in `parse`, see [docs](https://example.com):',
    '',
    '```ts',
    'const x = 1',
    '```',
    '',
    '- one',
    '- two',
    '',
    '> a quote',
  ].join('\n')

  it('parses every prefix of a whole answer without throwing', () => {
    for (const prefix of prefixes(answer)) {
      expect(() => parseMarkdown(prefix)).not.toThrow()
    }
  })

  it('never drops the visible tail of what has arrived', () => {
    // The last word typed has to be on screen. A parser that swallowed a
    // partial construct while waiting for its closer would strand the reader
    // watching a stream that had stopped moving.
    //
    // The document here carries no link, because a link is the one construct
    // whose visible text is dropped on purpose: §1.9 renders the URL instead
    // of the label, so `[docs](…)` really does lose the word `docs` the moment
    // its closing paren lands. That is a rendering decision, not a streaming
    // one, and folding it into this property would only blunt the property.
    const linkless = answer.replace('[docs](https://example.com)', 'the docs')
    for (const prefix of prefixes(linkless)) {
      const tail = prefix.match(/[A-Za-z0-9]+/g)?.at(-1)
      if (tail === undefined) continue
      expect(JSON.stringify(parseMarkdown(prefix))).toContain(tail)
    }
  })

  it('renders an unclosed fence as the same code block the closer produces', () => {
    // This is what makes live markdown safe to draw: the frame is not redrawn
    // when the fence closes, because there was nothing left to change.
    const open = parseMarkdown('text\n\n```ts\nconst x = 1')
    const closed = parseMarkdown('text\n\n```ts\nconst x = 1\n```')
    expect(open).toEqual(closed)
    expect(open[1]).toEqual({ kind: 'code-block', lang: 'ts', text: 'const x = 1' })
  })

  it('keeps an unterminated emphasis marker as literal text', () => {
    // `**bo` is text and `**bold**` is a bold node: the transition happens
    // inside one paragraph and costs no rows.
    expect(parseMarkdown('a **bo')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'a **bo' }] },
    ])
  })

  it('grows a list in place rather than re-forming it', () => {
    expect(parseMarkdown('- one\n- tw')).toEqual([
      { kind: 'list', ordered: false, items: [
        [{ kind: 'text', text: 'one' }],
        [{ kind: 'text', text: 'tw' }],
      ] },
    ])
  })

  it('treats a bare `#` as an empty heading rather than failing', () => {
    // One frame of an empty heading row before its text arrives. Worth naming:
    // it is the only construct that draws before it has anything to say.
    expect(parseMarkdown('#')).toEqual([{ kind: 'heading', level: 1, children: [] }])
  })
})

/**
 * The parse-boundary strip, which must leave a fence's contents alone.
 *
 * Before this existed, every code block in the TUI came out flush left. In
 * Python that is not a cosmetic loss — the block the user copies out does not
 * run — and it made syntax highlighting actively misleading, since coloring
 * structure the indentation no longer shows is worse than showing neither.
 */
describe('stripIndentOutsideFences', () => {
  it('preserves indentation inside a fenced block', () => {
    const md = '```py\ndef f():\n    if x:\n        return 1\n```'
    expect(stripIndentOutsideFences(md)).toBe(md)
  })

  it('still strips indentation outside the fence', () => {
    expect(stripIndentOutsideFences('a\n    b\n```\n    c\n```\n    d'))
      .toBe('a\nb\n```\n    c\n```\nd')
  })

  it('leaves the first line alone, matching the text-node strip', () => {
    expect(stripIndentOutsideFences('    a\n    b')).toBe('    a\nb')
  })

  it('agrees with stripLeadingIndent on a document with no fences', () => {
    // The two functions have to be the same function outside a fence, or the
    // defense-in-depth strip in `pushText` would start disagreeing with the
    // parse boundary about what a paragraph looks like.
    for (const text of ['a\n   b', 'a\n\nb', 'a\n \t b\n\n   c', '', 'x', '\n  y']) {
      expect(stripIndentOutsideFences(text)).toBe(stripLeadingIndent(text))
    }
  })

  it('protects an unclosed fence all the way to the end', () => {
    // This is the streaming case: the block is indented and its closer has not
    // arrived. Stripping while waiting would flatten the code and then unflatten
    // it when the fence closed — a reflow in the one place §1.9 promises none.
    expect(stripIndentOutsideFences('```py\ndef f():\n    return 1'))
      .toBe('```py\ndef f():\n    return 1')
  })

  it('does not let a shorter inner fence close a longer one', () => {
    const md = '````md\n```\n    still inside\n```\n````\n    outside'
    expect(stripIndentOutsideFences(md))
      .toBe('````md\n```\n    still inside\n```\n````\noutside')
  })

  it('does not let a tilde fence close a backtick fence', () => {
    expect(stripIndentOutsideFences('```\n~~~\n    kept\n```'))
      .toBe('```\n~~~\n    kept\n```')
  })

  it('handles tilde fences', () => {
    expect(stripIndentOutsideFences('~~~py\n    kept\n~~~\n    stripped'))
      .toBe('~~~py\n    kept\n~~~\nstripped')
  })

  it('still flattens a 4-space indented block, which is not a fence', () => {
    // Deliberate: an indent is a guess that the model meant code, and the guess
    // is wrong for the hand-indented lyrics this strip exists for.
    expect(stripIndentOutsideFences('text\n\n    looks like code'))
      .toBe('text\n\nlooks like code')
  })
})

describe('parseMarkdown code blocks', () => {
  it('keeps the indentation a code block needs to be code', () => {
    expect(parseMarkdown('```py\ndef f():\n    if x:\n        return 1\n```')).toEqual([
      { kind: 'code-block', lang: 'py', text: 'def f():\n    if x:\n        return 1' },
    ])
  })

  it('keeps it while the fence is still open', () => {
    expect(parseMarkdown('```py\ndef f():\n    return 1')).toEqual([
      { kind: 'code-block', lang: 'py', text: 'def f():\n    return 1' },
    ])
  })

  it('keeps a blank line inside a block', () => {
    const [block] = parseMarkdown('```ts\nconst a = 1\n\nconst b = 2\n```')
    expect(block).toEqual({ kind: 'code-block', lang: 'ts', text: 'const a = 1\n\nconst b = 2' })
  })
})
