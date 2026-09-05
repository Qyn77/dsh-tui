/**
 * How one entry looks, as opposed to which entries are on screen (that lives
 * in `message-scroll.spec.ts`) or how many rows one costs (`scroll.spec.ts`).
 *
 * The frame around a user message is the only box the conversation draws, and
 * it is pinned here because it is load-bearing in two directions at once: it
 * is the transcript's only marker of authorship, and it is two rows plus four
 * columns that `estimateEntryRows` has to predict exactly or paging stops
 * being invertible.
 * @module @deepseek-ai/dsh-tui/tests/message-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

/** The rows of the frame, newest turn last, as the screen has them. */
const rowsOf = (screen: string): string[] => screen.split('\n')

/** Index of the first row containing `needle`. */
function rowWith(rows: string[], needle: string): number {
  const index = rows.findIndex(row => row.includes(needle))
  expect(index, `no row contains ${needle}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('a user message is framed', () => {
  it('draws a box around what the user said', async () => {
    const painted = await paintApp({ turns: 2, rows: 40 })
    const rows = rowsOf(painted.screen())
    painted.unmount()

    const text = rowWith(rows, 'question 02')
    // Its own row is the box's middle, so the box's sides are on it and its
    // corners are on the rows either side.
    expect(rows[text]).toContain('│')
    expect(rows[text - 1]).toContain('╭')
    expect(rows[text + 1]).toContain('╰')
  })

  it('leaves an assistant turn unframed', async () => {
    // A turn is markdown, and a fenced code block draws its own box. A second
    // box around the turn would be a box inside a box.
    const painted = await paintApp({ turns: 2, rows: 40 })
    const rows = rowsOf(painted.screen())
    painted.unmount()

    const text = rowWith(rows, 'answer 02')
    expect(rows[text]).not.toContain('│')
    expect(rows[text - 1]).not.toContain('╭')
  })

  it('keeps the marker in the gutter beside the box', async () => {
    // The gutter is what holds the conversation's left edge on one column.
    // A box that pushed the `>` onto its own row would break that for the
    // one entry kind the user looks for first.
    const painted = await paintApp({ turns: 1, rows: 40 })
    const rows = rowsOf(painted.screen())
    painted.unmount()

    const top = rowWith(rows, 'question 01') - 1
    // One leading column is the viewport's own `paddingX`.
    expect(rows[top]).toMatch(/^ ?> ╭/)
  })

  it('fits a short terminal without overflowing the frame', async () => {
    // The App's root box has a fixed `rows - 3` height and Yoga overlaps
    // rather than scrolls whatever does not fit (SPEC §1.1). The viewport
    // clips, so the box must cost rows inside it and not beyond it.
    const painted = await paintApp({ turns: 6, rows: 24 })
    const rows = rowsOf(painted.screen())
    painted.unmount()

    expect(rows.length).toBeLessThanOrEqual(24 - 3)
    // Nothing overlapped: the newest turn is whole and legible.
    expect(rows.some(row => row.includes('answer 06'))).toBe(true)
  })
})
