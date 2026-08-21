# Resize reflow and Ink frame ownership

Status: Resolved

## Symptom

Dragging the terminal edge produced a ladder of narrower Prompt frames and,
in some widths, repeated Banner frames or a blank screen after the drag stopped.
The first transition between Banner width tiers often rendered correctly; a
slow drag through several intermediate widths did not.

## Root cause

Ink has two independent resize behaviours that cannot be mixed safely:

1. Ink subscribes to `stdout.resize` and immediately renders a frame.
2. The application was also clearing/re-rendering from a React hook.

During a resize, terminals may reflow already-written physical rows while Ink
still tracks logical rows. Direct `stdout.write` clears the pixels but leaves
Ink's `log-update` cursor/line bookkeeping stale; `useStdout().write` resets
bookkeeping but redraws Ink's cached old frame immediately. Either ordering can
leave duplicate frames or make the post-resize frame appear blank. A dynamic
Banner additionally makes the full frame cross Ink's `outputHeight >= rows`
append-mode threshold at narrow widths.

## Resolution

The TUI uses the alternate screen buffer. Real-TTY resize ownership lives in
`index.ts`, outside React:

- remove Ink's eager per-event resize listener;
- debounce the resize storm for 120ms;
- call Ink's public `instance.clear()` to reset its line bookkeeping;
- clear the alternate screen and call `instance.rerender()` once;
- read `stdout.rows`/`stdout.columns` during render instead of maintaining a
  second resize state;
- restore the primary screen on normal and error exit.

The component resize hook remains only for fake/non-TTY regression harnesses.

## Invariants

- There is exactly one owner of real-TTY resize rendering.
- Never clear the terminal from a React child without also resetting Ink's
  render instance.
- Never use a fixed Banner row offset: width tiers change physical height.
- A resize storm produces at most one full repaint after it settles.
- The alternate screen is always restored during teardown.

## Diagnostic sequence

Run with `DSH_TUI_DEBUG_RESIZE=1`. The trace is written to
`/tmp/dsh-tui-resize.log` and records resize dimensions, debounce settlement,
`instance.clear`, screen clear, and `instance.rerender` ordering. Do not infer
from a screenshot alone; first compare this event order with the terminal
trace.

