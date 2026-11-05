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
 * It owns one thing that is not strictly scroll: `expanded`, the global
 * preview cap. It lives here rather than in the App because expanding changes
 * the content's height, and `reportGeometry` below is what re-clamps the
 * offset when height changes — the two are the same mechanism, and splitting
 * them would mean the flag's owner could not see the consequence of setting
 * it. The name stays `…Scroll` because renaming it would touch two lesson
 * docs and every spec that cites it, for nothing.
 *
 * TerminalProvider owns the single Ink input subscription. This hook consumes
 * semantic keys, navigation and pointer events; protocol fragments and pasted
 * controls never reach scroll handlers.
 * @module @qiao-qyn/dsh-tui/hooks/useMessageListScroll
 */

import { useCallback, useRef, useState } from 'react'
import { useTerminalEvent, useTerminalInput } from '../terminal/TerminalProvider.tsx'
import {
  clampOffset,
  halfPageDelta,
  pageDelta,
  MOUSE_WHEEL_ROWS,
} from '../render/scroll.ts'

/** Measured heights of entries in the mounted, tail-anchored window. */
export interface MountedRows {
  start: number
  heights: readonly number[]
}

/** Remove rows introduced or removed solely by moving the window start. */
export function contentGrowth(
  previousRows: number, rows: number, previous?: MountedRows, next?: MountedRows,
): number {
  if (!previous || !next) return rows - previousRows
  const overlap = Math.max(previous.start, next.start)
  const oldPrefix = previous.heights.slice(0, overlap - previous.start).reduce((sum, height) => sum + height, 0)
  const newPrefix = next.heights.slice(0, overlap - next.start).reduce((sum, height) => sum + height, 0)
  return rows - previousRows + oldPrefix - newPrefix
}

/** Scroll position and the geometry channel the MessageList reports on. */
export interface MessageListScroll {
  jumpToOffset: (offset: number) => void
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
   * Every truncated preview is drawn at its raised cap instead of the 8-line
   * one. Global on purpose — see `docs/SPEC.md` §1.2: reaching *one* entry to
   * expand needs a focus model this app declines to have.
   */
  expanded: boolean
  /** Set the expand flag. `/verbose` calls this; `Ctrl-O` toggles it. */
  setExpanded: (expanded: boolean) => void
  /**
   * Report the measured height of the mounted content and of the viewport
   * after a layout. Called on every render; it only triggers work when a
   * number actually changed, so it cannot drive a render loop.
   */
  reportGeometry: (
    contentRows: number,
    viewportRows: number,
    tail?: unknown,
    totalRows?: number,
    mounted?: MountedRows,
  ) => void
}

/** Optional wiring for {@link useMessageListScroll}. */
export interface MessageListScrollOptions {
  active?: boolean
  /**
   * Whether ↑/↓ scroll the log. The Prompt claims those keys while its
   * slash palette is open or its buffer occupies more than one row, and Ink
   * hands one keystroke to *every* `useInput` handler with no way to stop
   * it — so ownership has to be decided by whoever renders both, and passed
   * in here. Defaults to true.
   *
   * Only the arrows and `Ctrl-U` are negotiable: `PageUp`/`PageDown` and
   * `Ctrl-B`/`Ctrl-F`/`Ctrl-D` always scroll the log, so the keyboard never
   * loses its way through history no matter what the prompt is doing.
   */
  arrowsScroll?: boolean
  /**
   * Whether `Ctrl-U` scrolls the log half a page. The Prompt claims it while
   * its buffer holds anything, because that is what `Ctrl-U` means in
   * readline — kill to the start of the line — and a user reaching for it to
   * clear a half-typed line instead watched the log jump half a page while
   * the line stayed put. An empty buffer hands the key back, so the binding
   * never disappears. Defaults to true.
   *
   * `Ctrl-D` is deliberately *not* negotiable in the same way: readline's
   * meaning for it is end-of-input, which this prompt has no use for, so
   * there is nothing to hand it back to.
   */
  ctrlUScrolls?: boolean
}

/** Own the conversation viewport's scroll position and its bindings. */
export function useMessageListScroll(
  { arrowsScroll = true, ctrlUScrolls = true, active = true }: MessageListScrollOptions = {},
): MessageListScroll {
  const [offset, setOffset] = useState(0)
  const [pinTop, setPinTop] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Geometry lives in a ref, not in state: the key handlers need the
  // current viewport height to size a page, but a measurement that
  // changes nothing about the offset must not cost a render.
  const geometry = useRef<{
    contentRows: number
    viewportRows: number
    tail?: unknown
    totalRows?: number
    mounted?: MountedRows
  }>({ contentRows: 0, viewportRows: 0 })

  const scrollBy = useCallback((rows: number): void => {
    if (rows === 0) return
    setPinTop(false)
    setOffset(current =>
      clampOffset(current + rows, geometry.current.contentRows, geometry.current.viewportRows),
    )
  }, [])

  const jumpToOffset = useCallback((next: number) => {
    setPinTop(false)
    setOffset(clampOffset(next, geometry.current.contentRows, geometry.current.viewportRows))
  }, [])

  const reportGeometry = useCallback(
    (contentRows: number, viewportRows: number, tail?: unknown, totalRows?: number, mounted?: MountedRows): void => {
      const previous = geometry.current
      geometry.current = { contentRows, viewportRows, tail, totalRows, mounted }
      const growth = contentGrowth(previous.contentRows, contentRows, previous.mounted, mounted)
      if (previous.contentRows === contentRows && previous.viewportRows === viewportRows && growth === 0) return
      // Re-clamp against the new bounds. This is what pins the view to the
      // newest row as a turn streams in (content grows, offset 0 stays 0),
      // and what collapses the offset back to the tail after `/clear`
      // empties the log.
      setOffset(current => pinTop
        ? Math.max(0, contentRows - viewportRows)
        : clampOffset(
          current > 0 && tail !== undefined && tail !== previous.tail
            ? current + growth
            : current,
          contentRows,
          viewportRows,
        ))
    },
    [pinTop],
  )

  useTerminalInput((input, key) => {
    if (!active) return
    const { viewportRows } = geometry.current
    // ↑/↓ scroll a row at a time, and that is also how the *wheel* arrives:
    // The adapter's selection mode requests alternate scroll rather than
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
          if (!ctrlUScrolls) return
          scrollBy(halfPageDelta(viewportRows))
          return
        case 'd':
          scrollBy(-halfPageDelta(viewportRows))
          return
        // Reaches us only because Ink puts the terminal in raw mode: in
        // cooked mode Ctrl-O is `VDISCARD` and the tty eats it. Raw mode is
        // not optional for this app, so the binding is safe — but that is
        // why it is free, and why no other TUI seems to use it.
        case 'o':
          setExpanded(current => !current)
          return
        default:
          return
      }
    }
  })

  useTerminalEvent((event) => {
    if (!active) return
    if (event.kind === 'pointer' && event.event.kind === 'wheel') {
      scrollBy(event.event.delta * MOUSE_WHEEL_ROWS)
    }
    if (event.kind !== 'navigation') return
    if (event.key === 'end') {
      setPinTop(false)
      setOffset(0)
    } else {
      setPinTop(true)
      setOffset(Math.max(0, geometry.current.contentRows - geometry.current.viewportRows))
    }
  })

  return { jumpToOffset, offset, atTail: offset === 0, pinTop, expanded, setExpanded, reportGeometry }
}
