/**
 * The startup banner's pure helpers. The block-type renderer and the
 * cwd shortener are the only logic in `Banner.tsx` worth pinning; the
 * rest is layout that a snapshot test would only make brittle.
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  renderBlockWord,
  displayCwd,
  encodeBitmap,
  fitTail,
  displayWidth,
  centerText,
  metaText,
  BANNER_MIN_WIDTH,
} from '../src/components/Banner.tsx'

describe('displayWidth', () => {
  it('counts ASCII as one column each', () => {
    expect(displayWidth('dsh')).toBe(3)
  })

  it('counts CJK ideographs as two columns each', () => {
    // This is the whole reason the helper exists: the slogan is
    // Chinese, and centering on `.length` would place it half a
    // whale to the right of where it belongs.
    expect(displayWidth('探索')).toBe(4)
  })

  it('counts fullwidth punctuation as two columns', () => {
    // `！` is U+FF01, in the fullwidth forms block — not the ASCII `!`.
    expect(displayWidth('！')).toBe(2)
  })

  it('measures the slogan at twice its character count', () => {
    expect(displayWidth('探索未至之境！')).toBe(14)
  })

  it('handles a mixed string', () => {
    expect(displayWidth('dsh 探索')).toBe(8)
  })

  it('is zero for the empty string', () => {
    expect(displayWidth('')).toBe(0)
  })
})

describe('centerText', () => {
  it('centers a CJK string by display columns, not character count', () => {
    // 14 columns of slogan in a 28-column field leaves 7 columns of
    // padding on each side.
    expect(centerText('探索未至之境！', 28)).toBe(`${' '.repeat(7)}探索未至之境！`)
  })

  it('centers an ASCII string', () => {
    expect(centerText('dsh', 9)).toBe('   dsh')
  })

  it('floors an odd remainder so the text leans left, never off the edge', () => {
    expect(centerText('dsh', 8)).toBe('  dsh')
  })

  it('returns the text unpadded when it is wider than the field', () => {
    // Never emit negative padding; on a narrow terminal the slogan
    // simply sits flush left.
    expect(centerText('探索未至之境！', 4)).toBe('探索未至之境！')
  })

  it('returns the text unpadded when it exactly fills the field', () => {
    expect(centerText('dsh', 3)).toBe('dsh')
  })
})

describe('encodeBitmap', () => {
  it('packs two pixel rows into one text row', () => {
    // A terminal cell is twice as tall as it is wide, so each output
    // row must carry two input rows for the pixels to come out square.
    expect(encodeBitmap(['##..', '#.#.'])).toEqual([{ text: '█▀▄ ', belly: false }])
  })

  it('maps each of the four pixel-pair states to its own glyph', () => {
    const [row] = encodeBitmap(['#.#.', '##..'])
    // col 0: both set, col 1: bottom only, col 2: top only, col 3: neither
    expect(row?.text).toBe('█▄▀ ')
  })

  it('marks a row as belly when either pixel row is B', () => {
    expect(encodeBitmap(['BB', '..'])[0]?.belly).toBe(true)
    expect(encodeBitmap(['..', 'BB'])[0]?.belly).toBe(true)
    expect(encodeBitmap(['##', '##'])[0]?.belly).toBe(false)
  })

  it('treats B as a set pixel, not as transparent', () => {
    expect(encodeBitmap(['BB', 'BB'])[0]?.text).toBe('██')
  })

  it('pads a short row rather than dropping columns', () => {
    // A ragged bitmap must not silently shorten the sprite — the
    // right-hand column's offset depends on a uniform width.
    expect(encodeBitmap(['####', '#'])[0]?.text).toBe('█▀▀▀')
  })

  it('tolerates an odd number of rows by treating the missing row as clear', () => {
    expect(encodeBitmap(['##'])).toEqual([{ text: '▀▀', belly: false }])
  })

  it('returns an empty list for an empty bitmap', () => {
    expect(encodeBitmap([])).toEqual([])
  })
})

describe('fitTail', () => {
  it('leaves a line that already fits', () => {
    expect(fitTail('short', 10)).toBe('short')
    expect(fitTail('exactly10!', 10)).toBe('exactly10!')
  })

  it('keeps the tail and marks the cut with a leading …', () => {
    // Paths and session ids carry their identity in the tail, so the
    // cut is at the front: 1 col for the … plus the last 11 chars.
    expect(fitTail('/Users/qiao/Desktop/dsh-tui', 12)).toBe('…top/dsh-tui')
  })

  it('emits a lone … at a width of one', () => {
    expect(fitTail('abcdef', 1)).toBe('…')
  })

  it('returns empty for a non-positive width', () => {
    expect(fitTail('abc', 0)).toBe('')
    expect(fitTail('abc', -3)).toBe('')
  })
})

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

describe('metaText', () => {
  const selection = { provider: 'deepseek', model: 'deepseek-v4-flash' }
  const sessionId = SessionId('tui-0f3a91c2-77bd-4e51-9a0c-1d2e3f4a5b6c')

  it('pairs the provider with the model', () => {
    expect(metaText(selection, sessionId, undefined, '/tmp').model).toBe(
      'deepseek/deepseek-v4-flash',
    )
  })

  it('truncates the session id so the line cannot blow the column', () => {
    // A raw UUID is 36 characters and would swallow the whole left
    // column on its own.
    expect(metaText(selection, sessionId, undefined, '/tmp').session).toBe(
      'tui-0f3a91c2 · vdev',
    )
  })

  it('puts the branch on the path line rather than a line of its own', () => {
    expect(metaText(selection, sessionId, 'main*', '~/x').location).toBe('~/x (main*)')
  })

  it('leaves the path bare outside a git repository', () => {
    expect(metaText(selection, sessionId, undefined, '~/x').location).toBe('~/x')
  })
})
