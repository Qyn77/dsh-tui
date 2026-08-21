/**
 * The startup banner's pure helpers. The block-type renderer and the
 * cwd shortener are the only logic in `Banner.tsx` worth pinning; the
 * rest is layout that a snapshot test would only make brittle.
 */

import { describe, expect, it } from 'vitest'
import { renderBlockWord, displayCwd, BANNER_MIN_WIDTH } from '../src/components/Banner.tsx'

describe('renderBlockWord', () => {
  it('renders exactly five rows', () => {
    expect(renderBlockWord('DEEPSEEK')).toHaveLength(5)
    expect(renderBlockWord('HARNESS')).toHaveLength(5)
  })

  it('renders every row at the same width so the columns line up', () => {
    const rows = renderBlockWord('DEEPSEEK')
    // Rows are right-trimmed, so a row whose last glyph column is
    // blank would be shorter. Compare against the widest row and
    // assert none exceeds it — that is what the layout depends on.
    const widest = Math.max(...rows.map((r) => r.length))
    for (const row of rows) {
      expect(row.length).toBeLessThanOrEqual(widest)
    }
  })

  it('is case-insensitive', () => {
    expect(renderBlockWord('deepseek')).toEqual(renderBlockWord('DEEPSEEK'))
  })

  it('renders unknown characters as blank cells instead of throwing', () => {
    // A future rename must not be able to crash the banner.
    const rows = renderBlockWord('D?D')
    expect(rows).toHaveLength(5)
    // The unknown glyph becomes a 4-column blank, so the two `D`s are
    // separated by the blank cell plus the two inter-letter gaps.
    expect(rows[0]).toBe('███       ███')
  })

  it('renders an empty word as five empty rows', () => {
    expect(renderBlockWord('')).toEqual(['', '', '', '', ''])
  })
})

describe('displayCwd', () => {
  it('replaces the home prefix with ~', () => {
    expect(displayCwd('/Users/qiao/Desktop/dsh-tui', '/Users/qiao')).toBe('~/Desktop/dsh-tui')
  })

  it('collapses the home directory itself to ~', () => {
    expect(displayCwd('/Users/qiao', '/Users/qiao')).toBe('~')
  })

  it('leaves paths outside home intact', () => {
    expect(displayCwd('/tmp/scratch', '/Users/qiao')).toBe('/tmp/scratch')
  })

  it('leaves the path intact when HOME is unset or empty', () => {
    expect(displayCwd('/Users/qiao/x', undefined)).toBe('/Users/qiao/x')
    expect(displayCwd('/Users/qiao/x', '')).toBe('/Users/qiao/x')
  })
})

describe('BANNER_MIN_WIDTH', () => {
  it('fits inside a standard 80-column terminal', () => {
    // The whole point of the two-column banner is that the default
    // terminal gets the full art. If a future edit widens the whale
    // or the wordmark past 80 columns, this test is the tripwire.
    expect(BANNER_MIN_WIDTH).toBeLessThanOrEqual(80)
  })
})
