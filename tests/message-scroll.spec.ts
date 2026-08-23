/**
 * The conversation viewport's *frame*, as opposed to its pure arithmetic
 * (that lives in `scroll.spec.ts`). These tests render the real `App`
 * against a fake TTY and read pixels, because every scroll bug this file
 * exists for was invisible to unit tests:
 *
 * - the window was sliced by **entry count** while the box clipped by
 *   **row**, top-anchored — so the clipped edge was the bottom and the
 *   newest messages could not be reached by any keystroke;
 * - Home/End were compared against an ESC-stripped string that Ink never
 *   delivers, so they were dead code that read as implemented;
 * - wheel reports are ordinary stdin data, so without a guard they were
 *   typed into the prompt buffer.
 *
 * Each of those is a property of the composed frame, not of a function.
 */

import { describe, expect, it } from 'vitest'
import { ESC, paintApp } from './fake-tty.ts'

describe('message list viewport', () => {
  it('shows the newest entry when the log is taller than the terminal', async () => {
    // The reported bug, reproduced: 20 entries in a 40-row terminal used
    // to render from `entries[8]` downward and clip the *bottom*, so the
    // screen stopped around turn 4 and turns 5..10 were unreachable.
    const painted = await paintApp({ turns: 10 })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('answer 10')
    // ...and the oldest turn is the one that got clipped away, which is
    // what proves the anchor is the tail rather than the head.
    expect(screen).not.toContain('question 01')
  })

  it('reveals older rows on PageUp and returns on PageDown', async () => {
    const painted = await paintApp({ turns: 10 })
    await painted.send(`${ESC}[5~`)
    const scrolledUp = painted.screen()
    await painted.send(`${ESC}[6~`)
    const scrolledBack = painted.screen()
    painted.unmount()

    // Older content came into view, and the hint says so. One page is one
    // viewport, not the whole log, so name the range rather than the top.
    expect(scrolledUp).toMatch(/answer 0[1-8]/)
    expect(scrolledUp).not.toContain('answer 10')
    expect(scrolledUp).toMatch(/more rows? below/)
    // Coming back reaches the newest row again and drops the hint.
    expect(scrolledBack).toContain('answer 10')
    expect(scrolledBack).not.toMatch(/more rows? below/)
  })

  it('pins back to the newest row on End after Home', async () => {
    const painted = await paintApp({ turns: 10 })
    await painted.send(`${ESC}[H`)
    const atHome = painted.screen()
    await painted.send(`${ESC}[F`)
    const atEnd = painted.screen()
    painted.unmount()

    expect(atHome).toContain('question 01')
    expect(atEnd).toContain('answer 10')
    expect(atEnd).not.toMatch(/more rows? below/)
  })

  it('scrolls a row at a time on the arrow keys, which is how the wheel arrives', async () => {
    // `index.ts` asks for alternate scroll mode rather than mouse reporting,
    // so the terminal answers a wheel notch with cursor keys and keeps its
    // own click-to-select. Three notches up, one row each.
    //
    // The terminal is short on purpose: the log has to stand more rows above
    // the fold than the notches being sent, or the offset clamps at the top
    // and the test measures the clamp instead of the step.
    const painted = await paintApp({ turns: 10, rows: 20 })
    for (let notch = 0; notch < 3; notch += 1) await painted.send(`${ESC}[A`)
    const scrolledUp = painted.screen()
    await painted.send(`${ESC}[B`)
    const oneBack = painted.screen()
    painted.unmount()

    expect(scrolledUp).toContain('↓ 3 more rows below')
    expect(oneBack).toContain('↓ 2 more rows below')
  })

  it('still scrolls on an SGR wheel report and never types it into the prompt', async () => {
    // We no longer ask for mouse reporting, but a terminal configured to
    // send it anyway must scroll rather than paste the report into the input.
    const painted = await paintApp({ turns: 10 })
    // One wheel-up notch: SGR encoding, button 64, at column 12 row 30.
    await painted.send(`${ESC}[<64;12;30M`)
    const scrolled = painted.screen()
    painted.unmount()

    expect(scrolled).toMatch(/more rows? below/)
    // The report must not survive as text anywhere on screen — the prompt
    // is the only place raw input could land.
    expect(scrolled).not.toContain('64;12;30')
    expect(scrolled).not.toContain('[<64')
  })
})
