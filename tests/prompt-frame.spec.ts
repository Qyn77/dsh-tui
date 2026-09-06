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

/**
 * The editing behaviour the box is *for*. These were unpinned for a long
 * while — `prompt.spec.ts` covered the two pure string helpers, so a caret
 * that never moved, a Backspace that ate the tail instead of the character
 * under the caret, or a Ctrl- keystroke typed into the buffer as text would
 * all have shipped green. The keystrokes are sent as the bytes a terminal
 * actually sends, so what is pinned is the whole path from stdin to frame.
 */
describe('prompt editing', () => {
  /** The buffer row, caret glyph included. */
  function buffer(screen: string): string {
    return promptBox(screen)[1] ?? ''
  }

  it('inserts at the caret after walking it left', async () => {
    const painted = await paintApp()
    await painted.send('abcd')
    await painted.send(`${ESC}[D`)
    await painted.send(`${ESC}[D`)
    await painted.send('X')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).toContain('abX▌cd')
  })

  it('deletes the character under the caret, not the tail', async () => {
    const painted = await paintApp()
    await painted.send('abcd')
    await painted.send(`${ESC}[D`)
    await painted.send(`${ESC}[D`)
    await painted.send('\x7f')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).toContain('a▌cd')
  })

  it('walks the caret to either end on Ctrl-A and Ctrl-E', async () => {
    // The first two bindings the prompt is allowed to claim, now that the
    // blanket `if (key.ctrl) return` is a split rather than a wall. They are
    // the buffer's ends because Home/End belong to the log — SPEC §1.6.
    const painted = await paintApp()
    await painted.send('abcd')
    await painted.send('\x01')
    const atStart = painted.screen()
    await painted.send('\x05')
    const atEnd = painted.screen()
    painted.unmount()

    expect(buffer(atStart)).toContain('▌abcd')
    expect(buffer(atEnd)).toContain('abcd▌')
  })

  it('deletes the word before the caret on Ctrl-W', async () => {
    const painted = await paintApp()
    await painted.send('git commit')
    await painted.send('\x17')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).toContain('git ▌')
  })

  it('deletes to the end of the buffer on Ctrl-K', async () => {
    const painted = await paintApp()
    await painted.send('git commit')
    await painted.send('\x01')
    await painted.send('\x0b')
    const screen = painted.screen()
    painted.unmount()

    // Caret to the start, then kill: the box is empty again, placeholder back.
    expect(buffer(screen)).toContain('Ask dsh anything…')
  })

  it('walks the caret by words on Alt-B and Alt-F', async () => {
    // Sent as the bytes a terminal sends for Option/Alt: ESC then the letter.
    const painted = await paintApp()
    await painted.send('git commit')
    await painted.send(`${ESC}b`)
    const back = painted.screen()
    await painted.send(`${ESC}f`)
    const forward = painted.screen()
    painted.unmount()

    expect(buffer(back)).toContain('git ▌commit')
    expect(buffer(forward)).toContain('git commit▌')
  })

  it('does not type a Ctrl- keystroke into the buffer', async () => {
    // Every Ctrl- binding the app has lives above the prompt. If one fell
    // through to the text path it would arrive as its bare letter, so
    // Ctrl-P would silently append a `p` to whatever the user was writing.
    const painted = await paintApp()
    await painted.send('hi')
    await painted.send('\x10')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).toContain('hi▌')
  })

  it('clears the buffer on Esc only while the palette is open', async () => {
    const painted = await paintApp()
    await painted.send('/he')
    await painted.send(ESC)
    const dismissed = painted.screen()
    await painted.send('plain text')
    await painted.send(ESC)
    const kept = painted.screen()
    painted.unmount()

    // Palette open: Esc is the way out, and it takes the buffer with it.
    expect(buffer(dismissed)).toContain('Ask dsh anything…')
    // Palette closed: Esc has no meaning here and must not discard work.
    expect(buffer(kept)).toContain('plain text▌')
  })

  it('completes the highlighted command on Tab, with a trailing space', async () => {
    const painted = await paintApp()
    await painted.send('/he')
    await painted.send('\t')
    const screen = painted.screen()
    painted.unmount()

    // The space is deliberate: arguments can be typed without another key.
    expect(buffer(screen)).toContain('/help ▌')
  })

  it('turns a trailing backslash plus Enter into a newline', async () => {
    const painted = await paintApp()
    await painted.send('first\\')
    await painted.send('\r')
    await painted.send('second')
    const box = promptBox(painted.screen())
    painted.unmount()

    expect(box).toHaveLength(4)
    expect(box[1]).toContain('first')
    expect(box[2]).toContain('second')
  })
})

/**
 * Pasting, end to end from stdin bytes to frame.
 *
 * `paste.spec.ts` pins the decoder; these exist because the bug was never in
 * the decoding. stdin delivers a large paste in several chunks, and when a
 * chunk boundary fell on a newline that chunk *was* a lone `\r` — which Ink
 * names `return` and the prompt submitted. Only the composed frame can show
 * that the message stayed in the box.
 */
describe('prompt paste', () => {
  /** The buffer row, caret glyph included. */
  function buffer(screen: string): string {
    return promptBox(screen)[1] ?? ''
  }

  it('keeps a chunk-split paste in the buffer instead of submitting at the newline', async () => {
    const painted = await paintApp()
    // Exactly how a terminal splits it: opener with the first line, the
    // newline alone, then the rest with the terminator.
    await painted.send(`${ESC}[200~first`)
    await painted.send('\r')
    await painted.send(`second${ESC}[201~`)
    const box = promptBox(painted.screen())
    painted.unmount()

    // Two rows in the box, and the text still *in* it: a submission would
    // have cleared the buffer and left `first` in the log.
    expect(box).toHaveLength(4)
    expect(box[1]).toContain('first')
    expect(box[2]).toContain('second')
  })

  it('accepts a paste that arrives as one chunk', async () => {
    const painted = await paintApp()
    await painted.send(`${ESC}[200~alpha\rbeta${ESC}[201~`)
    const box = promptBox(painted.screen())
    painted.unmount()

    expect(box).toHaveLength(4)
    expect(box[1]).toContain('alpha')
    expect(box[2]).toContain('beta')
  })

  it('does not let a pasted slash open the command palette mid-paste', async () => {
    // The palette keys off a leading `/`, and Enter with an exact match runs
    // the command. A pasted path must not be able to reach that.
    const painted = await paintApp()
    await painted.send(`${ESC}[200~/help\rtail${ESC}[201~`)
    const box = promptBox(painted.screen())
    painted.unmount()

    expect(box[1]).toContain('/help')
    expect(box[2]).toContain('tail')
  })

  it('still submits on a real Enter', async () => {
    // The guard against over-fixing: Enter arrives as the same `\r` byte, and
    // outside a paste it has to keep working.
    const painted = await paintApp()
    await painted.send('/help')
    await painted.send('\r')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).not.toContain('/help')
  })
})

describe('prompt history', () => {
  /** The buffer row, caret glyph included. */
  function buffer(screen: string): string {
    return promptBox(screen)[1] ?? ''
  }

  /**
   * Slash commands are submitted for real but handled locally, so the prompt
   * stays active and can take another keystroke. A plain message would start
   * a turn and deactivate the input, which is not what these tests are about.
   */
  async function submit(app: Awaited<ReturnType<typeof paintApp>>, line: string): Promise<void> {
    await app.send(line)
    await app.send('\r')
  }

  it('walks back through submitted lines on Ctrl-P', async () => {
    const painted = await paintApp()
    await submit(painted, '/help')
    await submit(painted, '/status')
    await painted.send('\x10')
    const newest = painted.screen()
    await painted.send('\x10')
    const older = painted.screen()
    painted.unmount()

    expect(buffer(newest)).toContain('/status▌')
    expect(buffer(older)).toContain('/help▌')
  })

  it('stops at the oldest entry instead of wrapping around', async () => {
    const painted = await paintApp()
    await submit(painted, '/help')
    await painted.send('\x10')
    await painted.send('\x10')
    await painted.send('\x10')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).toContain('/help▌')
  })

  it('hands back the half-written buffer on the way out with Ctrl-N', async () => {
    const painted = await paintApp()
    await submit(painted, '/help')
    await painted.send('unsent words')
    await painted.send('\x10')
    const recalled = painted.screen()
    await painted.send('\x0e')
    const restored = painted.screen()
    painted.unmount()

    expect(buffer(recalled)).toContain('/help▌')
    // The draft was not collateral damage of looking at history.
    expect(buffer(restored)).toContain('unsent words▌')
  })

  it('does nothing on Ctrl-P with nothing submitted yet', async () => {
    const painted = await paintApp()
    await painted.send('typing')
    await painted.send('\x10')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).toContain('typing▌')
  })

  it('does not record a repeated submission twice', async () => {
    const painted = await paintApp()
    await submit(painted, '/help')
    await submit(painted, '/help')
    await painted.send('\x10')
    await painted.send('\x10')
    const screen = painted.screen()
    painted.unmount()

    // Two Ctrl-P presses on a one-entry history land on that one entry.
    expect(buffer(screen)).toContain('/help▌')
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

/**
 * `Ctrl-U` and `Ctrl-C`, both of which change owner depending on whether
 * there is text in the box.
 *
 * Neither was a missing feature; both were keys that did something unrelated
 * to what the user reached for. `Ctrl-U` is readline's kill-to-start, and
 * pressing it to clear a half-typed line scrolled the log half a page while
 * the line sat there untouched. `Ctrl-C` closed the session outright, so
 * abandoning a sentence and abandoning the conversation were one keystroke.
 *
 * These have to be frame tests: the dispatch either side of the negotiation
 * passes in isolation, and only the composed app shows which one acted.
 */
describe('prompt and log both want Ctrl-U', () => {
  /** The buffer row, caret glyph included. */
  function buffer(screen: string): string {
    return promptBox(screen)[1] ?? ''
  }

  it('deletes to the start of a non-empty buffer and leaves the log alone', async () => {
    const painted = await paintApp({ turns: 10 })
    await painted.send('abcd')
    await painted.send(`${ESC}[D`)
    await painted.send(`${ESC}[D`)
    await painted.send('\x15')
    const screen = painted.screen()
    painted.unmount()

    // Killed to the start, not the whole buffer: the tail after the caret
    // survives, which is what distinguishes this from a plain clear.
    expect(buffer(screen)).toContain('▌cd')
    expect(buffer(screen)).not.toContain('ab')
    // And the log did not move.
    expect(screen).not.toMatch(/more rows? below/)
  })

  it('hands the key back to the log once the buffer is empty', async () => {
    // The negotiation has to be reversible, or the binding disappears for
    // anyone who has ever typed a character.
    const painted = await paintApp({ turns: 10 })
    await painted.send('\x15')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toMatch(/more rows? below/)
  })

  it('gives the key back after the buffer is emptied again', async () => {
    const painted = await paintApp({ turns: 10 })
    await painted.send('xy')
    await painted.send('\x15')
    // Buffer is empty again — this second press belongs to the log.
    await painted.send('\x15')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toMatch(/more rows? below/)
  })
})

describe('Ctrl-C asks before it closes the session', () => {
  /** The buffer row, caret glyph included. */
  function buffer(screen: string): string {
    return promptBox(screen)[1] ?? ''
  }

  it('clears a half-written line instead of arming the exit', async () => {
    const painted = await paintApp()
    await painted.send('half a thought')
    await painted.send('\x03')
    const screen = painted.screen()
    painted.unmount()

    expect(buffer(screen)).not.toContain('half a thought')
    // Nothing was armed: the press was spent on the line.
    expect(screen).not.toContain('again to exit')
  })

  it('arms the exit on a bare press and says so', async () => {
    const painted = await paintApp()
    await painted.send('\x03')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('again to exit')
  })

  it('disarms on any other key', async () => {
    // The rule is "the second press must be the next press". A notice that
    // lingered would make a much later Ctrl-C exit without warning.
    const painted = await paintApp()
    await painted.send('\x03')
    await painted.send('z')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('again to exit')
    expect(buffer(screen)).toContain('z')
  })

  it('takes the notice down again when the line is cleared', async () => {
    // Ctrl-C with text clears the line and disarms; the press after that is
    // a fresh first press, not the second half of an older one.
    const painted = await paintApp()
    await painted.send('\x03')
    await painted.send('typed')
    await painted.send('\x03')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('again to exit')
  })
})

describe('the caret remembers the column it is aiming for', () => {
  /** Every row of the box, so a caret on any of them can be asserted on. */
  function rows(screen: string): string {
    return promptBox(screen).join('\n')
  }

  /** A long row, a short one, a long one. The caret starts at the end. */
  const staircase = 'aaaaaaaa\nbb\ncccccccc'
  const UP = `${ESC}[A`

  it('walks back up through a short row to the column it left', async () => {
    const painted = await paintApp()
    await painted.send(staircase)
    await painted.send(UP)
    const middle = painted.screen()
    await painted.send(UP)
    const top = painted.screen()
    painted.unmount()

    // The short row can only offer its end...
    expect(rows(middle)).toContain('bb▌')
    // ...but the column survived it: column eight, not the two the short
    // row would have handed on.
    expect(rows(top)).toContain('aaaaaaaa▌')
  })

  it('forgets the column as soon as the caret moves for any other reason', async () => {
    const painted = await paintApp()
    await painted.send(staircase)
    await painted.send(UP)
    await painted.send(`${ESC}[D`)
    await painted.send(UP)
    const screen = painted.screen()
    painted.unmount()

    // ← put the caret between the two b's, and that is where the walk
    // resumes from. Honouring the stale column here would move the caret
    // somewhere the user never put it.
    expect(rows(screen)).toContain('a▌aaaaaaa')
  })
})

describe('the @ file picker', () => {
  it('opens on a mention and offers the file being typed', async () => {
    const painted = await paintApp()
    await painted.send('read @src/prompt-lay')
    // The directory walk is real I/O; give it a moment to come back.
    await painted.settle(200)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('src/prompt-layout.ts')
    expect(screen).toContain('Tab or Enter insert path')
  })

  it('inserts the highlighted path on Tab, closing the picker', async () => {
    const painted = await paintApp()
    await painted.send('read @src/prompt-lay')
    await painted.settle(200)
    await painted.send('\t')
    const screen = painted.screen()
    painted.unmount()

    expect(promptBox(screen).join('\n')).toContain('read @src/prompt-layout.ts ▌')
    // The trailing space closed the token, so the list is gone.
    expect(screen).not.toContain('Tab or Enter insert path')
  })

  it('stays shut for an @ that does not open a word', async () => {
    // The picker must not appear — and must not take ↑/↓ — while someone is
    // writing an email address into a question.
    const painted = await paintApp()
    await painted.send('mail qiao@example')
    await painted.settle(200)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Tab or Enter insert path')
  })

  it('dismisses on Esc without eating the words around it', async () => {
    const painted = await paintApp()
    await painted.send('read @src/prompt-lay')
    await painted.settle(200)
    await painted.send(ESC)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Tab or Enter insert path')
    expect(promptBox(screen).join('\n')).toContain('read @src/prompt-lay▌')
  })

  it('sends the line on Enter once the picker has been dismissed', async () => {
    const painted = await paintApp()
    await painted.send('read @src/prompt-lay')
    await painted.settle(200)
    await painted.send(ESC)
    await painted.send('\r')
    const screen = painted.screen()
    painted.unmount()

    expect(promptBox(screen).join('\n')).not.toContain('read @src')
  })
})

/**
 * The floating palette against a terminal that cannot hold it.
 *
 * The App gives its root box a fixed `stdout.rows - 3` height so Ink stays on
 * log-update's incremental path. Yoga does not scroll a subtree that
 * overflows a fixed height — it lays the surplus rows over the ones already
 * there. So an uncapped palette does not merely look cramped: it prints two
 * commands on one line, eats the StatusBar and the prompt box, and strands
 * fragments of itself on screen until the next resize repaints everything.
 * Which is precisely the "leftover re-rendered content" a 24-row window
 * showed with the fifteen built-in commands listed at once.
 */
describe('the palette on a terminal too short to hold it', () => {
  it('shows every command when the terminal has room for them', async () => {
    const painted = await paintApp({ turns: 2, rows: 60 })
    await painted.send('/c')
    const screen = painted.screen()
    painted.unmount()

    // `/clear`, `/context`, `/copy` — the whole `c` family, no counter.
    expect(screen).toContain('/clear')
    expect(screen).toContain('/context')
    expect(screen).toContain('/copy')
    expect(screen).not.toContain('more')
  })

  it('windows the list rather than overflowing a 24-row terminal', async () => {
    const painted = await paintApp({ turns: 2, rows: 24 })
    await painted.send('/')
    const screen = painted.screen()
    painted.unmount()

    // Eight rows shown, the rest counted. Without the cap all seventeen were
    // laid out, and the frame came back with `/quit` and `/plugins` printed
    // on the same line.
    expect(screen).toContain('/clear')
    expect(screen).toContain('/history')
    expect(screen).not.toContain('/plugins')
    expect(screen).not.toContain('/verbose')
    expect(screen).toContain('+9 more')
  })

  it('leaves the StatusBar and the prompt box whole underneath it', async () => {
    // The palette consumed its neighbours before it consumed itself. The
    // StatusBar's identity row vanished under the token row, and the prompt
    // box lost its top border to its own content — the frame came back with
    // a line reading `╰─> /▌────`, which is the debris a resize was clearing.
    const painted = await paintApp({ turns: 2, rows: 24 })
    await painted.send('/')
    const rows = painted.screen().split('\n')
    painted.unmount()

    expect(rows.some(row => row.includes('session: tui-fram'))).toBe(true)
    expect(rows.some(row => /^│ > \/▌/.test(row))).toBe(true)
    expect(rows.some(row => row.includes('╰─>'))).toBe(false)
  })

  it('scrolls the window down to keep the selection visible', async () => {
    const painted = await paintApp({ turns: 2, rows: 24 })
    await painted.send('/')
    // Sixteen downs is the last of the seventeen built-ins: far enough past
    // the eighth row to have dragged the window all the way to the bottom.
    for (let i = 0; i < 16; i += 1) await painted.send(`${ESC}[B`)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('/verbose')
    expect(screen).not.toContain('/clear')
  })
})

/**
 * Typing while the model works. The prompt used to go inert for the whole
 * turn, so every one of these keystrokes had nowhere to land; making the box
 * live during a turn is what puts the frame back in play, and the frame is
 * the only place the collisions show.
 */
describe('the palette on a terminal too narrow for its longest description', () => {
  /** The `·` column of every command row on screen. */
  const bulletColumns = (screen: string): Set<number> =>
    new Set(
      screen
        .split('\n')
        // Anchored, because the banner's tip row (`Tip: /help · /status`)
        // otherwise reads as a command row and lands on its own column.
        .filter(line => /^│ +\/[a-z]+ +· /.test(line))
        .map(line => line.indexOf('·')),
    )

  it('lines every row up on the same bullet column', async () => {
    // Only the *selected* row used to be padded to the name column, so the
    // descriptions stepped sideways as the selection moved and the list read
    // as three ragged columns rather than two.
    const painted = await paintApp({ turns: 0, columns: 120, rows: 40 })
    await painted.send('/')
    const columns = bulletColumns(painted.screen())
    painted.unmount()

    expect(columns.size).toBe(1)
  })

  it('keeps them lined up when the widest description will not fit', async () => {
    const painted = await paintApp({ turns: 0, columns: 90, rows: 40 })
    await painted.send('/')
    const screen = painted.screen()
    painted.unmount()

    expect(bulletColumns(screen).size).toBe(1)
    // The description is what gives way, and it says so with an ellipsis.
    expect(screen).toContain('/copy')
    expect(screen).toMatch(/Copy the newest reply .*…/)
  })

  it('never lets an over-long row cost a second line', async () => {
    // A description that wrapped instead of truncating would make the palette
    // taller than `paletteWindowRows` promised, which is the overflow the
    // window exists to prevent — see `bannerRowBudget` in `renderer.tsx`.
    const painted = await paintApp({ turns: 0, columns: 60, rows: 40 })
    await painted.send('/')
    const screen = painted.screen()
    painted.unmount()

    const rows = screen.split('\n').filter(line => /^│ +\/[a-z]+ +· /.test(line))
    expect(rows).toHaveLength(8)
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(60)
  })

  it('keeps the selected row on the same column as the rest', async () => {
    // The selected row carries a leading space inside its background block;
    // the others need a matching one or the bullet steps left when the
    // highlight moves off a row.
    const painted = await paintApp({ turns: 0, columns: 120, rows: 40 })
    await painted.send('/')
    await painted.send(`${ESC}[B`)
    const columns = bulletColumns(painted.screen())
    painted.unmount()

    expect(columns.size).toBe(1)
  })
})

describe('steering a running turn', () => {
  /** Open a turn the way the session plugin does, without answering it. */
  const startTurn = async (painted: Awaited<ReturnType<typeof paintApp>>): Promise<void> => {
    await painted.append('turn/start', { turn: 1 })
  }

  it('keeps taking input and says what Enter will do', async () => {
    const painted = await paintApp()
    await startTurn(painted)
    await painted.send('use pnpm')
    const box = promptBox(painted.screen()).join('\n')
    painted.unmount()

    expect(box).toContain('use pnpm')
  })

  it('captions the empty box with steering rather than working', async () => {
    const painted = await paintApp()
    await startTurn(painted)
    const box = promptBox(painted.screen()).join('\n')
    painted.unmount()

    expect(box).toContain('steering')
    expect(box).not.toContain('working')
  })

  it('routes Enter to steer, not to followup', async () => {
    const steered: unknown[] = []
    const followed: unknown[] = []
    const painted = await paintApp({
      steer: m => steered.push(m),
      followup: m => followed.push(m),
    })
    await startTurn(painted)
    await painted.send('use pnpm')
    await painted.send('\r')
    painted.unmount()

    expect(steered).toHaveLength(1)
    expect(followed).toHaveLength(0)
  })

  it('routes Enter to followup while idle', async () => {
    const steered: unknown[] = []
    const followed: unknown[] = []
    const painted = await paintApp({
      steer: m => steered.push(m),
      followup: m => followed.push(m),
    })
    await painted.send('use pnpm')
    await painted.send('\r')
    painted.unmount()

    expect(followed).toHaveLength(1)
    expect(steered).toHaveLength(0)
  })

  it('refuses a slash command mid-turn instead of running it', async () => {
    const painted = await paintApp()
    await startTurn(painted)
    await painted.send('/help')
    await painted.send('\r')
    await painted.settle(120)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('commands wait for the turn to finish')
    expect(screen).not.toContain('Available commands:')
  })

  it('cancels the turn on Ctrl-C and leaves the half-written line alone', async () => {
    const cancelled: unknown[] = []
    const painted = await paintApp({ cancel: c => cancelled.push(c) })
    await startTurn(painted)
    await painted.send('use pnpm')
    await painted.send('\x03')
    const box = promptBox(painted.screen()).join('\n')
    painted.unmount()

    expect(cancelled).toHaveLength(1)
    expect(box).toContain('use pnpm')
  })

  it('cancels the turn on Esc', async () => {
    const cancelled: unknown[] = []
    const painted = await paintApp({ cancel: c => cancelled.push(c) })
    await startTurn(painted)
    await painted.send(ESC)
    painted.unmount()

    expect(cancelled).toHaveLength(1)
  })

  it('lets Esc close the palette without cancelling the turn under it', async () => {
    const cancelled: unknown[] = []
    const painted = await paintApp({ cancel: c => cancelled.push(c) })
    await startTurn(painted)
    await painted.send('/he')
    await painted.send(ESC)
    const screen = painted.screen()
    painted.unmount()

    expect(cancelled).toHaveLength(0)
    // Not 'Tab complete' — the banner's own tip row ends in 'Tab completes'.
    expect(screen).not.toContain('Esc dismiss')
  })
})
