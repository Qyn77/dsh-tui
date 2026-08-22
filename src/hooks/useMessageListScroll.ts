/**
 * Scroll state and key bindings for the conversation viewport.
 *
 * The offset this hook owns is measured in **rows above the newest row**,
 * not in entries: `0` follows the live tail, `12` means the view sits
 * twelve rows up in history. The MessageList reports its measured geometry
 * back here after every layout, and that measurement is what bounds the
 * offset — so the top of the log is a real, exact stop rather than an
 * estimate.
 *
 * There are two input paths on purpose. Everything Ink reports faithfully
 * (arrows, `PageUp`/`PageDown`, `Ctrl-`-modified letters, and any mouse
 * report it forwards as ordinary input) is handled through `useInput`.
 * `Home` and
 * `End` cannot be: Ink blanks `input` for those key names and publishes no
 * flag for them, so the keystroke is indistinguishable from noise by the
 * time `useInput` sees it. Those two are read from the raw chunk Ink
 * republishes on its own stdin event emitter, ahead of that normalisation.
 * See `parseNavKey` in `../scroll.ts`.
 *
 * That emitter, and not `stdin` itself, is deliberate. Ink 5 reads input
 * with a `readable` listener plus `stdin.read()`; attaching a `data`
 * listener to the same stream switches it to flowing mode, which drains
 * chunks out from under Ink's read loop and breaks typing altogether. The
 * emitter carries the identical chunk with none of that risk — it is what
 * Ink's own `useInput` consumes.
 * @module @deepseek-ai/dsh-tui/hooks/useMessageListScroll
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useInput, useStdin } from 'ink'
import {
  clampOffset,
  halfPageDelta,
  isMouseReport,
  pageDelta,
  parseNavKey,
  parseWheelDelta,
} from '../scroll.ts'

/** Scroll position and the geometry channel the MessageList reports on. */
export interface MessageListScroll {
  /**
   * Rows the view is lifted above the newest row. `0` follows the tail,
   * which is what keeps a running turn's output on screen.
   */
  offset: number
  /** Following the live tail. Drives the "scrolled into history" hint. */
  atTail: boolean
  /**
   * The user asked for the very beginning (`Home`), so the whole log has
   * to be mounted — the offset alone cannot reach past the mounted
   * window, and creeping toward the top one window at a time would be
   * both slow and visibly wrong.
   */
  pinTop: boolean
  /**
   * Report the measured height of the mounted content and of the viewport
   * after a layout. Called on every render; it only triggers work when a
   * number actually changed, so it cannot drive a render loop.
   */
  reportGeometry: (contentRows: number, viewportRows: number) => void
}

/** Optional wiring for {@link useMessageListScroll}. */
export interface MessageListScrollOptions {
  /**
   * Whether ↑/↓ scroll the log. The Prompt claims those keys while its
   * slash palette is open or its buffer occupies more than one row, and Ink
   * hands one keystroke to *every* `useInput` handler with no way to stop
   * it — so ownership has to be decided by whoever renders both, and passed
   * in here. Defaults to true.
   *
   * Only the arrows are negotiable: `PageUp`/`PageDown` and `Ctrl-B/F/U/D`
   * always scroll the log, so the keyboard never loses its way through
   * history no matter what the prompt is doing.
   */
  arrowsScroll?: boolean
}

/** Own the conversation viewport's scroll position and its bindings. */
export function useMessageListScroll(
  { arrowsScroll = true }: MessageListScrollOptions = {},
): MessageListScroll {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { internal_eventEmitter: events } = useStdin()
  const [offset, setOffset] = useState(0)
  const [pinTop, setPinTop] = useState(false)
  // Geometry lives in a ref, not in state: the key handlers need the
  // current viewport height to size a page, but a measurement that
  // changes nothing about the offset must not cost a render.
  const geometry = useRef({ contentRows: 0, viewportRows: 0 })

  const scrollBy = useCallback((rows: number): void => {
    if (rows === 0) return
    setPinTop(false)
    setOffset((current) =>
      clampOffset(current + rows, geometry.current.contentRows, geometry.current.viewportRows),
    )
  }, [])

  const reportGeometry = useCallback(
    (contentRows: number, viewportRows: number): void => {
      const previous = geometry.current
      if (previous.contentRows === contentRows && previous.viewportRows === viewportRows) return
      geometry.current = { contentRows, viewportRows }
      // Re-clamp against the new bounds. This is what pins the view to the
      // newest row as a turn streams in (content grows, offset 0 stays 0),
      // and what collapses the offset back to the tail after `/clear`
      // empties the log.
      setOffset((current) =>
        pinTop
          ? Math.max(0, contentRows - viewportRows)
          : clampOffset(current, contentRows, viewportRows),
      )
    },
    [pinTop],
  )

  useInput((input, key) => {
    const { viewportRows } = geometry.current
    // ↑/↓ scroll a row at a time, and that is also how the *wheel* arrives:
    // `index.ts` asks the terminal for alternate scroll mode rather than
    // mouse reporting, so a notch is delivered as cursor keys and the
    // terminal keeps its own click-to-select. They are the one binding the
    // prompt can take away from us — see `arrowsScroll`.
    if (arrowsScroll && key.upArrow) {
      scrollBy(1)
      return
    }
    if (arrowsScroll && key.downArrow) {
      scrollBy(-1)
      return
    }
    if (key.pageUp) {
      scrollBy(pageDelta(viewportRows))
      return
    }
    if (key.pageDown) {
      scrollBy(-pageDelta(viewportRows))
      return
    }
    // `Ctrl-` bindings exist because `PageUp`/`PageDown` need `Fn` on a
    // laptop keyboard, and a scroll you need two hands for is a scroll
    // people stop using. The Prompt ignores every `Ctrl-` keystroke, so
    // these cannot collide with typing.
    if (key.ctrl) {
      switch (input) {
        case 'b':
          scrollBy(pageDelta(viewportRows))
          return
        case 'f':
          scrollBy(-pageDelta(viewportRows))
          return
        case 'u':
          scrollBy(halfPageDelta(viewportRows))
          return
        case 'd':
          scrollBy(-halfPageDelta(viewportRows))
          return
        default:
          return
      }
    }
    // Ink forwards mouse reports as ordinary input. We no longer *ask* the
    // terminal for them — that costs click-to-select, see `index.ts` — but a
    // terminal configured to send them anyway should still scroll rather
    // than type gibberish into the prompt.
    if (isMouseReport(input)) scrollBy(parseWheelDelta(input))
  })

  useEffect(() => {
    if (events === undefined) return
    const onChunk = (data: Buffer | string): void => {
      const nav = parseNavKey(typeof data === 'string' ? data : data.toString('utf8'))
      if (nav === undefined) return
      if (nav === 'end') {
        setPinTop(false)
        setOffset(0)
        return
      }
      // `Home` cannot be expressed as an offset yet — the rows it wants
      // are not mounted. Ask for the whole log to mount, *and* move to the
      // top of what is already mounted: when the log is short enough to be
      // fully mounted already the geometry never changes, and a `pinTop`
      // that only acts on a geometry report would leave the view sitting
      // at the tail. The next report (if the window did grow) lands it on
      // the real top.
      setPinTop(true)
      setOffset(Math.max(0, geometry.current.contentRows - geometry.current.viewportRows))
    }
    events.on('input', onChunk)
    return () => {
      events.off('input', onChunk)
    }
  }, [events])

  return { offset, atTail: offset === 0, pinTop, reportGeometry }
}
