/**
 * Repaint the screen from scratch once a terminal resize settles.
 *
 * Ink erases the previous dynamic frame with
 * `eraseLines(<logical line count>)` — cursor-relative arithmetic that
 * assumes one logical line still occupies one physical row. A resize breaks
 * that assumption in a way no amount of width arithmetic can fix: terminals
 * that **reflow** (rewrap the rows already on screen when the window
 * narrows, as iTerm2 and Terminal.app do) turn each row of the last frame
 * into two, so a 3-row prompt box now occupies six rows while Ink still
 * erases four. The two surviving rows are the debris — and because the
 * survivors are soft-wrapped halves, copying them out of the scrollback
 * rejoins the top border into a convincing `╭───╮` while the content row's
 * continuation (the half carrying its closing `│`) is gone. A window drag
 * therefore left a ladder of half-drawn prompt boxes, one per step.
 *
 * The frame is not recoverable by counting better, so this stops counting:
 * when the resize storm goes quiet, erase the whole visible screen and let
 * Ink lay the frame down again at the top. `useStdout().write` is Ink's own
 * escape hatch for this — it clears the live frame, writes what we give it,
 * and redraws the frame afterwards, resetting `log-update`'s line count on
 * the way through. Whatever the terminal did to the old rows is irrelevant
 * once they are gone.
 *
 * Two consequences, both deliberate:
 *
 *   - The startup banner is static output that lives *above* the frame, so
 *     clearing the screen clears it too. A resize therefore ends with a
 *     clean screen showing the session and the prompt, which is what the
 *     banner already promised by being "past output that scrolls away".
 *     `/clear` prints a fresh one.
 *   - Debris is visible *during* a drag and disappears when it stops. That
 *     is the same deal `vim` and `less` offer, and it is the reason this is
 *     trailing-edge only: the repaint has to land after Ink's own final
 *     resize render, or it would redraw a frame laid out for the previous
 *     width and hand the terminal something to reflow all over again.
 *
 * @module @deepseek-ai/dsh-tui/hooks/useResizeRepaint
 */

import { useEffect } from 'react'
import { useStdout } from 'ink'

/**
 * Erase the visible screen and park the cursor at its top-left. Spelled
 * with `\u001B` escapes rather than literal escape bytes, so the source
 * stays greppable and diffable. Deliberately *not* `clearTerminal`, which also drops the
 * scrollback (`3J`) — the user's shell history above the app is theirs.
 */
const CLEAR_SCREEN = '\u001B[2J\u001B[H'

/**
 * Milliseconds of quiet that end a resize storm. Comfortably past Ink's own
 * 32ms render throttle, so the repaint always follows the frame it is
 * repairing, and short enough that letting go of a window edge feels like
 * the redraw was part of the drag.
 */
const QUIET_MS = 120

/**
 * Subscribe to `resize` and repaint once it settles. No-op when stdout is
 * not an event emitter (piped output, tests that pass a bare object).
 * @param quietMs - override the settle delay; for tests.
 */
export function useResizeRepaint(quietMs: number = QUIET_MS): void {
  const { stdout, write } = useStdout()
  useEffect(() => {
    if (stdout === undefined || typeof stdout.on !== 'function') return
    let timer: NodeJS.Timeout | undefined
    const onResize = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        write(CLEAR_SCREEN)
      }, quietMs)
      // A pending repaint must never be the reason the process is still
      // alive; Ctrl-C during a drag should exit now, not in 120ms.
      if (typeof timer.unref === 'function') timer.unref()
    }
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [stdout, write, quietMs])
}
