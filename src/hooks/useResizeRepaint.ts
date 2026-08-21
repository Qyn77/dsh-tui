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
 * Ink lay the frame down again at the top. The leading-edge clear uses the
 * raw stdout stream intentionally: Ink's `write` helper redraws its previous
 * frame immediately after custom data, which would replay a frame measured
 * at the old width during the resize storm. The trailing-edge clear uses
 * Ink's helper so the settled frame is redrawn after the clear.
 *
 * Two consequences, both deliberate:
 *
 *   - The startup banner is static output that lives *above* the frame, so
 *     clearing the screen clears it too. A resize therefore ends with a
 *     clean screen showing the session and the prompt, which is what the
 *     banner already promised by being "past output that scrolls away".
 *     `/clear` prints a fresh one.
 *   - The first clear happens synchronously for every resize event, so a
 *     reflowing terminal never gets a chance to stack another visible frame
 *     on top of the old one. The trailing-edge clear remains necessary because
 *     Ink's final resize render runs as part of the same event storm.
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

// Banner is a fixed 19-row splash. Keep it intact while clearing the
// resize-sensitive live frame below it.

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
export function useResizeRepaint(quietMs: number = QUIET_MS, onResizeCallback?: () => void): void {
  const { stdout, write } = useStdout()
  useEffect(() => {
    if (stdout === undefined || typeof stdout.on !== 'function') return
    if (stdout.isTTY === true) return
    let timer: NodeJS.Timeout | undefined
    const onResize = (): void => {
      // Test/dry-run streams do not model a real terminal screen; keep their
      // static output stable. A real TTY needs the banner replay because the
      // raw clear below legitimately removes previously emitted Static output.
      // Clear before Ink's resize render can leave the old frame behind.
      // Reflowing terminals may have already changed its physical row count,
      // so log-update cannot reliably erase it with cursor-relative math.
      // Use the stream directly. Ink's `write` helper clears its tracked
      // frame and immediately redraws `lastOutput` after our data, which is
      // still laid out for the previous width during a resize storm. That
      // redraw is the source of the stacked, progressively narrower prompt
      // boxes. A raw clear leaves Ink nothing stale to redraw; its next
      // resize render paints the current layout on a clean screen.
      stdout.write(CLEAR_SCREEN)
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        // At the trailing edge, go through Ink so it redraws the latest
        // frame after clearing. By then `lastOutput` has the settled width.
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
  }, [stdout, write, quietMs, onResizeCallback])
}
