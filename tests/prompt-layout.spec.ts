/**
 * The prompt's line layout: how a buffer folds into display rows, where the
 * caret lands, which rows are visible, and what the scrollbar looks like.
 *
 * These are pinned first and hard because the caret position is *derived*
 * from the same wrap the renderer draws. If the two disagree by one column
 * the caret sits in the wrong place, which is the kind of bug that looks
 * like "the terminal is broken" rather than "this function is off by one".
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_PROMPT_ROWS,
  cursorAt,
  scrollbarColumn,
  visibleStart,
  wrapBuffer,
} from '../src/prompt-layout.ts'

/** Just the text of each row — the shape most assertions care about. */
const texts = (value: string, width: number): string[] =>
  wrapBuffer(value, width).map((row) => row.text)

describe('wrapBuffer', () => {
  it('returns one empty row for an empty buffer', () => {
    // The caret needs a row to sit on even when there is nothing to show.
    expect(wrapBuffer('', 10)).toEqual([{ text: '', start: 0 }])
  })

  it('keeps a line that fits on one row', () => {
    expect(wrapBuffer('hello', 10)).toEqual([{ text: 'hello', start: 0 }])
  })

  it('folds a long line by character, not by word', () => {
    // Word wrapping would put the caret arithmetic and the rendered rows on
    // different pages. Hard folds keep them identical.
    expect(texts('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('records each row start as an index into the buffer', () => {
    expect(wrapBuffer('abcdefghij', 4)).toEqual([
      { text: 'abcd', start: 0 },
      { text: 'efgh', start: 4 },
      { text: 'ij', start: 8 },
    ])
  })

  it('breaks at an explicit newline and does not keep it in the row text', () => {
    expect(wrapBuffer('ab\ncd', 10)).toEqual([
      { text: 'ab', start: 0 },
      { text: 'cd', start: 3 },
    ])
  })

  it('adds an empty row after a trailing newline', () => {
    // Ctrl-J on the last row has to leave the caret somewhere.
    expect(wrapBuffer('ab\n', 10)).toEqual([
      { text: 'ab', start: 0 },
      { text: '', start: 3 },
    ])
  })

  it('keeps consecutive newlines as empty rows', () => {
    expect(texts('a\n\nb', 10)).toEqual(['a', '', 'b'])
  })

  it('counts CJK as two columns', () => {
    // Four columns of budget is two ideographs, not four.
    expect(texts('探索未至', 4)).toEqual(['探索', '未至'])
  })

  it('moves a wide character down rather than splitting the cell', () => {
    // 'ab' fills two of three columns; '探' needs two and would land half
    // outside, so it starts the next row and column 3 goes unused. A
    // terminal cannot draw half a CJK cell.
    expect(texts('ab探索', 3)).toEqual(['ab', '探', '索'])
    // And it fits when the remaining columns are enough: 1 + 2 = 3.
    expect(texts('a探', 3)).toEqual(['a探'])
  })

  it('survives a degenerate width by folding one character per row', () => {
    expect(texts('abc', 0)).toEqual(['a', 'b', 'c'])
    expect(texts('探索', 1)).toEqual(['探', '索'])
  })
})

describe('cursorAt', () => {
  const rows = wrapBuffer('abcdefghij', 4) // abcd / efgh / ij

  it('places the caret at the start of the first row', () => {
    expect(cursorAt(rows, 0)).toEqual({ row: 0, offset: 0 })
  })

  it('places the caret inside a row', () => {
    expect(cursorAt(rows, 2)).toEqual({ row: 0, offset: 2 })
  })

  it('places a caret on a soft-wrap boundary at the start of the next row', () => {
    // Index 4 is both "after abcd" and "before efgh". Rendering it at the
    // head of the next row is what a terminal editor does, and it is the
    // only choice that keeps typing visible at the fold.
    expect(cursorAt(rows, 4)).toEqual({ row: 1, offset: 0 })
  })

  it('places the caret at the very end', () => {
    expect(cursorAt(rows, 10)).toEqual({ row: 2, offset: 2 })
  })

  it('lands on the empty row after a trailing newline', () => {
    const withBreak = wrapBuffer('ab\n', 10)
    expect(cursorAt(withBreak, 3)).toEqual({ row: 1, offset: 0 })
  })

  it('clamps a cursor outside the buffer instead of returning NaN', () => {
    expect(cursorAt(rows, -5)).toEqual({ row: 0, offset: 0 })
    expect(cursorAt(rows, 99)).toEqual({ row: 2, offset: 2 })
  })
})

describe('visibleStart', () => {
  it('stays at the top while everything fits', () => {
    expect(visibleStart(3, 2, 10, 0)).toBe(0)
  })

  it('follows the caret past the bottom edge', () => {
    // 20 rows, a 10-row window at the top, caret on row 12 → the window
    // ends at the caret.
    expect(visibleStart(20, 12, 10, 0)).toBe(3)
  })

  it('follows the caret past the top edge', () => {
    expect(visibleStart(20, 2, 10, 8)).toBe(2)
  })

  it('leaves the window alone while the caret is inside it', () => {
    expect(visibleStart(20, 9, 10, 5)).toBe(5)
  })

  it('never scrolls past the last row', () => {
    expect(visibleStart(20, 19, 10, 99)).toBe(10)
  })

  it('never scrolls above the first row', () => {
    expect(visibleStart(20, 0, 10, -4)).toBe(0)
  })
})

describe('scrollbarColumn', () => {
  it('is blank when the content fits, and still occupies the column', () => {
    // The column is reserved unconditionally: if it appeared only on
    // overflow, the text width would change at that moment and every row
    // would re-fold under the caret.
    expect(scrollbarColumn(4, 10, 0)).toEqual([' ', ' ', ' ', ' '])
  })

  it('is exactly as long as the visible window', () => {
    expect(scrollbarColumn(40, 10, 0)).toHaveLength(10)
    expect(scrollbarColumn(40, 10, 30)).toHaveLength(10)
  })

  it('puts the thumb at the top when the view is at the top', () => {
    const column = scrollbarColumn(20, 10, 0)
    expect(column[0]).toBe('█')
    expect(column.at(-1)).toBe('│')
  })

  it('puts the thumb at the bottom when the view is at the bottom', () => {
    const column = scrollbarColumn(20, 10, 10)
    expect(column[0]).toBe('│')
    expect(column.at(-1)).toBe('█')
  })

  it('keeps a visible thumb even for a very long buffer', () => {
    const column = scrollbarColumn(2000, 10, 500)
    expect(column.filter((glyph) => glyph === '█')).toHaveLength(1)
  })

  it('sizes the thumb in proportion to the visible fraction', () => {
    // Half the buffer visible → half the bar is thumb.
    const column = scrollbarColumn(20, 10, 0)
    expect(column.filter((glyph) => glyph === '█')).toHaveLength(5)
  })
})

describe('MAX_PROMPT_ROWS', () => {
  it('is the agreed ten rows of text', () => {
    // Pinned because it is a product decision, not an implementation
    // detail: ten rows plus the border is twelve, which still leaves a
    // usable conversation on a 24-row terminal.
    expect(MAX_PROMPT_ROWS).toBe(10)
  })
})
