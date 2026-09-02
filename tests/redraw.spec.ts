/**
 * `Ctrl-L` — repaint the screen on demand.
 *
 * The binding is one line in the App, and it would be easy to test the wrong
 * thing about it. What matters is not that a clear was written: that part is
 * trivial and a raw `stdout.write` would satisfy it while leaving the terminal
 * blank until the next keystroke. Ink drops any frame byte-identical to the one
 * it last wrote, and a redraw request is *by definition* asking for the
 * identical frame, so the interesting assertion is that a frame lands **after**
 * the clear. That is the same trap `resize.ts` documents, reached by a
 * keystroke instead of a window drag.
 * @module @deepseek-ai/dsh-tui/tests/redraw.spec
 */

import { describe, expect, it } from 'vitest'
import { ESC, paintApp } from './fake-tty.ts'

/** Ink parses the raw control byte; `Ctrl-L` is form feed. */
const CTRL_L = String.fromCharCode(12)
const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`

describe('Ctrl-L', () => {
  it('clears the screen and puts the frame back after the clear', async () => {
    const painted = await paintApp({ turns: 2, debug: false })
    await painted.send(CTRL_L)
    const written = painted.written()
    painted.unmount()

    const clear = written.lastIndexOf(CLEAR_SCREEN)
    expect(clear).toBeGreaterThanOrEqual(0)
    // The prompt is drawn *after* the last clear. Without Ink's own writer
    // this index would be -1: the screen wiped, nothing redrawn.
    expect(written.indexOf('Ask dsh anything', clear)).toBeGreaterThan(clear)
  })

  it('redraws the conversation, not just the chrome', async () => {
    const painted = await paintApp({ turns: 2, debug: false })
    await painted.send(CTRL_L)
    const written = painted.written()
    const screen = painted.screen()
    painted.unmount()

    expect(written.slice(written.lastIndexOf(CLEAR_SCREEN))).toContain('answer 02')
    expect(screen).toContain('answer 02')
  })

  it('changes nothing the app believes — not the buffer, not the scroll offset', async () => {
    // A redraw repairs pixels. Anything else it touched would make it a
    // navigation key that happens to clear the screen, which is not what
    // `Ctrl-L` means anywhere else a user has typed it.
    const painted = await paintApp({ turns: 10, rows: 20, debug: false })
    await painted.send('half-typed')
    await painted.send(`${ESC}[5~`)
    const before = painted.screen()
    await painted.send(CTRL_L)
    const after = painted.screen()
    painted.unmount()

    expect(before).toContain('half-typed')
    expect(after).toContain('half-typed')
    // Still parked in history: the offset survived, so the hint does too.
    expect(after).toMatch(/more rows? below/)
    expect(after).not.toContain('answer 10')
  })

  it('does not type an `l` into the prompt on its way through', async () => {
    // Ink hands the keystroke to every `useInput` handler, and it delivers a
    // `Ctrl-` chord as its bare letter. The Prompt returns early on any ctrl
    // key, which is what keeps this from being `ll` after two presses.
    const painted = await paintApp({ debug: false })
    await painted.send('ab')
    await painted.send(CTRL_L)
    await painted.send(CTRL_L)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('ab')
    expect(screen).not.toContain('abl')
  })
})
