/**
 * The input box's *frame*: how tall it actually renders, when the scrollbar
 * appears, and who owns ↑/↓. The arithmetic is pinned in
 * `prompt-layout.spec.ts`; these tests exist because the height cap and the
 * key ownership are properties of the composed frame:
 *
 * - a row Ink re-wraps grows the box past its cap, and no unit test over
 *   `wrapBuffer` can see that;
 * - Ink hands one keystroke to *every* `useInput` handler with no way to
 *   stop it, so "↑ moved the caret" and "↑ also scrolled the log" both
 *   pass in isolation and only the frame shows the collision.
 * @module @deepseek-ai/dsh-tui/tests/prompt-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { MAX_PROMPT_ROWS } from '../src/prompt-layout.ts'
import { ESC, paintApp } from './fake-tty.ts'

/**
 * The rows of the input box, borders included. It is the last bordered box
 * in the frame (the banner, the log entries and the status bar all draw
 * their own), so the last corner glyphs delimit it.
 */
function promptBox(screen: string): string[] {
  const rows = screen.split('\n')
  // `findLastIndex` needs a newer lib target than this package compiles to.
  const last = (glyph: string): number => {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i]?.includes(glyph)) return i
    }
    return -1
  }
  const top = last('╭')
  const bottom = last('╰')
  expect(bottom).toBeGreaterThan(top)
  return rows.slice(top, bottom + 1)
}

/** `count` distinct, hard-broken rows: no width arithmetic to get wrong. */
function lines(count: number): string {
  return Array.from({ length: count }, (_, i) => `r${String(i + 1).padStart(2, '0')}`).join('\n')
}

describe('prompt box height', () => {
  it('is one row tall while the buffer is empty', async () => {
    const painted = await paintApp()
    const box = promptBox(painted.screen())
    painted.unmount()

    expect(box).toHaveLength(3)
    expect(box[1]).toContain('Ask dsh anything…')
  })

  it('grows with the buffer', async () => {
    const painted = await paintApp()
    await painted.send(lines(3))
    const box = promptBox(painted.screen())
    painted.unmount()

    // Three rows plus the two border rows, and every row is on screen.
    expect(box).toHaveLength(5)
    expect(box.join('\n')).toContain('r01')
    expect(box.join('\n')).toContain('r03')
  })

  it('stops growing at the cap and keeps the caret in view', async () => {
    const painted = await paintApp()
    await painted.send(lines(30))
    const box = promptBox(painted.screen())
    painted.unmount()

    // The whole point of the feature: 30 rows of input cannot push the log
    // off the screen, so the box tops out and scrolls inside itself.
    expect(box).toHaveLength(MAX_PROMPT_ROWS + 2)
    // The caret sits at the end of the buffer, so the window is at the
    // bottom: the newest row is visible and the oldest has scrolled away.
    expect(box.join('\n')).toContain('r30')
    expect(box.join('\n')).not.toContain('r01')
  })

  it('shows a scrollbar thumb only once the buffer overflows the cap', async () => {
    const painted = await paintApp()
    await painted.send(lines(3))
    const fits = promptBox(painted.screen()).join('\n')
    await painted.send(lines(30))
    const overflows = promptBox(painted.screen()).join('\n')
    painted.unmount()

    expect(fits).not.toContain('█')
    expect(overflows).toContain('█')
  })

  it('inserts a newline on Ctrl-J instead of submitting', async () => {
    // Ink parses Ctrl-J as the linefeed it is, so it arrives as ordinary
    // input '\n' rather than as a ctrl keystroke — which is why the
    // prompt's `if (key.ctrl) return` guard does not swallow it.
    const painted = await paintApp()
    await painted.send('hi')
    expect(promptBox(painted.screen())).toHaveLength(3)
    await painted.send('\n')
    await painted.send('there')
    const box = promptBox(painted.screen())
    painted.unmount()

    expect(box).toHaveLength(4)
    expect(box[1]).toContain('hi')
    expect(box[2]).toContain('there')
  })
})

describe('prompt and log both want the arrow keys', () => {
  it('moves the caret and leaves the log alone once the buffer is multi-row', async () => {
    const painted = await paintApp({ turns: 10 })
    await painted.send(lines(3))
    const before = painted.screen()
    await painted.send(`${ESC}[A`)
    const after = painted.screen()
    painted.unmount()

    // The caret walked from the last row to the one above it...
    expect(before).toContain('r03▌')
    expect(after).toContain('r02▌')
    // ...and the log did not move an inch: still pinned to the newest row,
    // still no "scrolled into history" hint.
    expect(after).toContain('answer 10')
    expect(after).not.toMatch(/more rows? below/)
  })

  it('still scrolls the log on PageUp while the prompt owns the arrows', async () => {
    // Only ↑/↓ are negotiable. If the paging keys could be claimed too,
    // a half-written multi-row message would lock the log shut.
    const painted = await paintApp({ turns: 10 })
    await painted.send(lines(3))
    await painted.send(`${ESC}[5~`)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toMatch(/more rows? below/)
    // ...and paging the log did not disturb the buffer.
    expect(promptBox(screen).join('\n')).toContain('r03▌')
  })

  it('scrolls the log on the arrows while the buffer is a single row', async () => {
    // The common case: nothing typed yet, so a wheel notch (delivered as a
    // cursor key under alternate scroll mode) still reaches the log.
    const painted = await paintApp({ turns: 10 })
    await painted.send('one row')
    await painted.send(`${ESC}[A`)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('↓ 1 more row below')
    expect(promptBox(screen).join('\n')).toContain('one row')
  })
})
