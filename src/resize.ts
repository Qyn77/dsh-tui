/**
 * The single owner of real-TTY resize repainting, lifted out of `index.ts`
 * so it can be tested against a fake terminal.
 *
 * The shape of the sequence — debounce the storm, `instance.clear()`, clear
 * the alternate screen, `instance.rerender()` once — is the one the resize
 * lesson settled on and it is unchanged here. What is new is the last step,
 * and it exists because the sequence above can legitimately draw *nothing*:
 *
 * Ink suppresses a redraw whose output string is byte-identical to the frame
 * it last wrote (`ink/ink.js`: `if (!hasStaticOutput && output !==
 * this.lastOutput)`), and `instance.clear()` resets `log-update`'s line
 * bookkeeping *without* resetting that cached string. So after we erase the
 * screen ourselves, a rerender that happens to produce the same frame is
 * dropped — and the screen stays blank until the next keystroke. Two very
 * ordinary drags land there:
 *
 *   - **Height-only resize.** Only `frameHeight` reads `stdout.rows`, and it
 *     is `undefined` while the session is empty, so dragging the bottom edge
 *     of a fresh session produces the identical frame.
 *   - **Any drag that ends where it started** — out and back, maximize then
 *     restore, a tmux zoom toggle. The settled width equals the width of the
 *     last frame Ink wrote, so the string matches again.
 *
 * The repair is not to defeat the comparison (the frame really is identical)
 * but to stop depending on Ink choosing to write. `repaint` is Ink's own
 * `useStdout().write`, captured from inside the tree: it clears log-update's
 * frame, writes our payload, and then re-emits the cached frame
 * **unconditionally**. Running it after the rerender — never during the
 * storm, when the cached frame is still laid out for the old width — is what
 * makes a settled resize always end with pixels on screen.
 *
 * @module @deepseek-ai/dsh-tui/resize
 */

/**
 * Erase the visible screen and park the cursor at its top-left. Spelled with
 * `\u001B` escapes rather than literal escape bytes so the source stays
 * greppable. Deliberately *not* `clearTerminal`, which also drops the
 * scrollback (`3J`) — the user's shell history above the app is theirs.
 */
export const CLEAR_SCREEN = '\u001B[2J\u001B[H'

/**
 * Milliseconds of quiet that end a resize storm. Comfortably past Ink's own
 * 32ms render throttle, so the repaint always follows the frame it is
 * repairing, and short enough that letting go of a window edge feels like
 * the redraw was part of the drag.
 */
export const RESIZE_QUIET_MS = 120

/**
 * Ink's `useStdout().write`, published by the App once it has mounted. A ref
 * rather than a prop callback because the writer is only reachable from
 * inside Ink's tree, while the resize owner lives outside React.
 */
export interface RepaintRef {
  current?: ((data: string) => void) | undefined
}

/** The subset of a TTY stdout the owner touches. */
export interface ResizeStdout {
  columns?: number | undefined
  rows?: number | undefined
  write: (data: string) => unknown
  on: (event: 'resize', listener: () => void) => unknown
  off: (event: 'resize', listener: () => void) => unknown
  removeAllListeners: (event: 'resize') => unknown
}

/** Everything the owner needs from the Ink render instance and the App. */
export interface ResizeOwner {
  stdout: ResizeStdout
  /** `instance.clear()` — resets log-update's line bookkeeping. */
  clear: () => void
  /** `instance.rerender(<App/>)` with a freshly created element. */
  rerender: () => void
  /** Filled in by the App; see {@link RepaintRef}. */
  repaint: RepaintRef
  /** Override the settle delay; for tests. */
  quietMs?: number
  /** Optional trace sink for `DSH_TUI_DEBUG_RESIZE=1`. */
  log?: ((message: string) => void) | undefined
}

/**
 * Subscribe to `resize` and repaint once the storm settles. Returns the
 * detach function; call it before unmounting Ink.
 *
 * Ink installs its own eager listener that renders immediately for every
 * SIGWINCH. It is removed rather than left in place: it renders the *existing*
 * React tree, so it cannot refresh `frameHeight` from the new row count, and
 * every frame it writes mid-storm is one more thing for a reflowing terminal
 * to smear.
 */
export function installResizeOwner(owner: ResizeOwner): () => void {
  const { stdout, clear, rerender, repaint, quietMs = RESIZE_QUIET_MS, log } = owner
  let timer: NodeJS.Timeout | undefined

  const settle = (): void => {
    timer = undefined
    log?.(`settled before-clear columns=${stdout.columns ?? 0} rows=${stdout.rows ?? 0}`)
    // Use Ink's public instance API so its line-count bookkeeping and the
    // terminal screen are reset as one operation. Rendering from a child hook
    // cannot access this state and leaves the next frame positioned relative
    // to the old cursor after a resize.
    clear()
    log?.('instance.clear done')
    stdout.write(CLEAR_SCREEN)
    log?.('clear-screen written')
    // React re-render, not just a relayout: `frameHeight` is computed from
    // `stdout.rows` during render, so only a rerender can pick up a
    // height-only resize.
    rerender()
    log?.('instance.rerender called')
    const paint = repaint.current
    if (paint === undefined) {
      // The App has not mounted yet (or is on its way out). The rerender
      // above is all there is, and there is no stale frame to repair either.
      log?.('repaint unavailable')
      return
    }
    // Unconditional: Ink would otherwise drop a frame identical to the one it
    // last wrote, leaving the screen we just cleared empty.
    paint(CLEAR_SCREEN)
    log?.('repaint written')
  }

  const onResize = (): void => {
    log?.(`event columns=${stdout.columns ?? 0} rows=${stdout.rows ?? 0}`)
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(settle, quietMs)
    // A pending repaint must never be the reason the process is still alive;
    // Ctrl-C during a drag should exit now, not in 120ms.
    if (typeof timer.unref === 'function') timer.unref()
  }

  stdout.removeAllListeners('resize')
  stdout.on('resize', onResize)
  return () => {
    stdout.off('resize', onResize)
    if (timer !== undefined) clearTimeout(timer)
  }
}
