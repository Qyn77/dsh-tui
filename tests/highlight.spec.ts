/**
 * Syntax highlighting: the cache's arithmetic, and the one assumption it rests
 * on.
 *
 * Most of this runs against a fake tokenizer, because what the cache has to get
 * right — which lines it re-tokenizes, and what state it hands each one — is
 * invisible in the colors that come out. The last block runs against real Shiki
 * to pin the equality the whole design depends on: tokenizing a block one line
 * at a time, threading the grammar state, is indistinguishable from tokenizing
 * it whole. If that ever stopped being true the symptom would be subtly wrong
 * colors inside a block comment, which no other test would catch.
 * @module @deepseek-ai/dsh-tui/tests/highlight.spec
 */

import { describe, expect, it } from 'vitest'
import {
  codeToken,
  createLineCache,
  highlightLang,
  loadTokenizer,
  type LineTokenizer,
} from '../src/highlight.ts'
import { palette } from '../src/theme.ts'

/** The dark appearance's Shiki theme — what these tests tokenize under. */
const THEME = palette('dark').shikiTheme

/**
 * A tokenizer that reports what it was given, so the cache can be observed.
 *
 * The state it threads is the previous line, so a line's token text spells out
 * the chain the cache handed it: `'b>c'` is line `c` tokenized after line `b`.
 */
const echo: LineTokenizer = (line, state) => ({
  line: line === '' ? [] : [{ text: `${typeof state === 'string' ? state : 'start'}>${line}` }],
  state: line,
})

/** The text of every token on every line, flattened per line. */
function texts(lines: readonly { text: string }[][]): string[] {
  return lines.map(line => line.map(token => token.text).join(''))
}

describe('codeToken', () => {
  it('carries the content and the color', () => {
    expect(codeToken({ content: 'const', color: '#F97583' }))
      .toEqual({ text: 'const', color: '#F97583' })
  })

  it('omits a color that Shiki did not set', () => {
    expect(codeToken({ content: 'x' })).toEqual({ text: 'x' })
  })

  it('reads -1 ("not set") as plain, the same as 0', () => {
    // Shiki emits -1 far more often than 0, and a naive bit test on -1 sets
    // every flag at once — the whole block would come out bold and italic.
    expect(codeToken({ content: 'x', fontStyle: -1 })).toEqual({ text: 'x' })
    expect(codeToken({ content: 'x', fontStyle: 0 })).toEqual({ text: 'x' })
  })

  it('maps the font-style bits onto Ink props', () => {
    expect(codeToken({ content: 'a', fontStyle: 1 })).toEqual({ text: 'a', italic: true })
    expect(codeToken({ content: 'a', fontStyle: 2 })).toEqual({ text: 'a', bold: true })
    expect(codeToken({ content: 'a', fontStyle: 4 })).toEqual({ text: 'a', underline: true })
    expect(codeToken({ content: 'a', fontStyle: 3 }))
      .toEqual({ text: 'a', bold: true, italic: true })
  })

  it('ignores a bit it has no analog for (strikethrough)', () => {
    expect(codeToken({ content: 'a', fontStyle: 8 })).toEqual({ text: 'a' })
  })
})

describe('highlightLang', () => {
  it('passes a language through, normalized', () => {
    expect(highlightLang('TS')).toBe('ts')
    expect(highlightLang('  python  ')).toBe('python')
  })

  it('leaves the plain-text family unhighlighted', () => {
    for (const word of ['', 'text', 'txt', 'plaintext', 'plain', 'console', 'output', 'log']) {
      expect(highlightLang(word)).toBeUndefined()
    }
  })

  it('does not pre-judge an unknown word', () => {
    // The grammar load decides. A word this repo has never heard of has to
    // reach Shiki, which knows far more aliases than a table here would.
    expect(highlightLang('nim')).toBe('nim')
  })
})

describe('createLineCache', () => {
  it('returns one line per source line', () => {
    const cache = createLineCache(echo)
    expect(texts(cache.lines('a\nb\nc'))).toEqual(['start>a', 'a>b', 'b>c'])
    expect(cache.tokenized()).toBe(3)
  })

  it('threads the grammar state from each line into the next', () => {
    // The whole design rests on this: line 3 is tokenized knowing it is inside
    // whatever line 2 left open.
    const cache = createLineCache(echo)
    expect(texts(cache.lines('x\ny'))).toEqual(['start>x', 'x>y'])
  })

  it('re-tokenizes only the appended lines', () => {
    const cache = createLineCache(echo)
    cache.lines('a\nb')
    expect(cache.tokenized()).toBe(2)
    cache.lines('a\nb\nc\nd')
    // Two new lines, not four: this is the property the streaming path needs.
    expect(cache.tokenized()).toBe(4)
  })

  it('re-tokenizes only the growing last line while a delta lands mid-word', () => {
    // What streaming actually looks like: the tail line is rewritten character
    // by character and every settled line above it is already done.
    const cache = createLineCache(echo)
    cache.lines('done\npar')
    cache.lines('done\npart')
    cache.lines('done\npartial')
    // One for `done`, then one per revision of the tail.
    expect(cache.tokenized()).toBe(4)
    expect(texts(cache.lines('done\npartial'))).toEqual(['start>done', 'done>partial'])
    // A repeat of the same text costs nothing at all.
    expect(cache.tokenized()).toBe(4)
  })

  it('reuses only the prefix before an edit, not the lines after it', () => {
    const cache = createLineCache(echo)
    cache.lines('a\nb\nc')
    cache.lines('a\nB\nc')
    // `a` survived; `B` and the `c` below it are re-tokenized, because `c` was
    // handed a different incoming state and could legitimately color differently.
    expect(cache.tokenized()).toBe(5)
    expect(texts(cache.lines('a\nB\nc'))).toEqual(['start>a', 'a>B', 'B>c'])
  })

  it('drops lines when the code shrinks', () => {
    const cache = createLineCache(echo)
    cache.lines('a\nb\nc')
    expect(texts(cache.lines('a\nb'))).toEqual(['start>a', 'a>b'])
  })

  it('renders an empty line as an empty token list', () => {
    const cache = createLineCache(echo)
    expect(cache.lines('a\n\nb')[1]).toEqual([])
  })

  it('treats empty code as one empty line', () => {
    // `''.split('\n')` is `['']`, and the block still owns a row.
    expect(createLineCache(echo).lines('')).toHaveLength(1)
  })
})

/**
 * A snippet chosen for the constructs that span lines. Highlighting any of
 * these correctly is impossible without carrying state across the line
 * boundary, so they are what tell an incremental tokenizer from a broken one.
 */
const TRICKY = [
  'const a = 1',
  '/* a block comment',
  '   const fake = "not code" */',
  'function f(x: string) {',
  '  return `tpl ${x}',
  'still inside the template`',
  '}',
].join('\n')

describe('loadTokenizer (real Shiki)', () => {
  it('reproduces a whole-block highlight, line by line', async () => {
    const tokenize = await loadTokenizer('ts', THEME)
    expect(tokenize).toBeDefined()
    if (tokenize === undefined) return
    const incremental = createLineCache(tokenize).lines(TRICKY)

    const { createHighlighter } = await import('shiki')
    const shiki = await createHighlighter({ themes: [THEME], langs: ['ts'] })
    const oneShot = shiki.codeToTokens(TRICKY, { lang: 'ts', theme: THEME })
      .tokens.map(line => line.map(codeToken))

    expect(incremental).toEqual(oneShot)
  })

  it('still reproduces it when the block arrives one delta at a time', async () => {
    const tokenize = await loadTokenizer('ts', THEME)
    if (tokenize === undefined) throw new Error('ts grammar did not load')
    const cache = createLineCache(tokenize)
    // Deltas do not respect line boundaries, so step by a character count that
    // does not divide any line length evenly.
    for (let end = 7; end < TRICKY.length; end += 7) cache.lines(TRICKY.slice(0, end))
    const streamed = cache.lines(TRICKY)

    const fresh = createLineCache(tokenize).lines(TRICKY)
    expect(streamed).toEqual(fresh)
    // And it did not pay for the whole block on every delta: a naive memo would
    // have tokenized `lines × deltas`, which is an order of magnitude more.
    expect(cache.tokenized()).toBeLessThan(TRICKY.split('\n').length * 8)
  })

  it('colors a keyword, so the grammar is really in force', async () => {
    const tokenize = await loadTokenizer('ts', THEME)
    if (tokenize === undefined) throw new Error('ts grammar did not load')
    const [line] = createLineCache(tokenize).lines('const x = 1')
    expect(line?.[0]).toMatchObject({ text: 'const' })
    expect(line?.[0]?.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })

  it('returns undefined for a word that is not a language', async () => {
    expect(await loadTokenizer('definitely-not-a-language', THEME)).toBeUndefined()
    // Cached, so a fence full of nonsense costs one rejected load per session.
    expect(await loadTokenizer('definitely-not-a-language', THEME)).toBeUndefined()
  })
})
