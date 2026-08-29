# Resize reflow and Ink frame ownership

Status: Resolved (in two passes — see both root-cause sections)

## Symptom

Dragging the terminal edge produced a ladder of narrower Prompt frames and,
in some widths, repeated Banner frames or a blank screen after the drag
stopped. The first transition between Banner width tiers often rendered
correctly; a slow drag through several intermediate widths did not.

The ladder and the blank screen turned out to have **different root causes**.
Fixing the first left the second in place, and this note was marked resolved
while the blank screen was still reproducible — a drag that ended at its
starting width, or any drag of the bottom edge alone, cleared the screen and
left it empty. Both root causes are recorded below, in the order they were
found.

## First root cause — the frame ladder

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

### Resolution

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

That fixed the ladder of frames. It did **not** fix the blank screen listed
above, and the second attempt is why: clearing the screen ourselves and then
asking Ink to draw assumes Ink will draw.

## Second root cause — the blank screen

Ink drops a render whose output string is byte-identical to the frame it last
wrote:

```js
// ink/build/ink.js
if (!hasStaticOutput && output !== this.lastOutput) { this.throttledLog(output) }
this.lastOutput = output
```

`instance.clear()` resets `log-update`'s line bookkeeping and writes the
erase, but it never touches `lastOutput`. So the settled sequence *clear →
erase screen → rerender* can end with an erased screen and no frame, and it
does so for two ordinary gestures:

- **A height-only drag.** Nothing in the layout reads `stdout.rows` except
  `frameHeight`, which is `undefined` while the session is empty — so the
  frame is identical. (In a *short* terminal the case hides itself: the frame
  no longer fits, Ink takes its `outputHeight >= rows` branch, and that branch
  writes unconditionally. Reproducing it needs a terminal tall enough for the
  banner.)
- **A drag that ends where it began** — out and back, maximize then restore, a
  tmux zoom toggle. The settled width equals the width of the last frame Ink
  wrote.

The repair is not to defeat the comparison — the frame really is unchanged —
but to stop depending on Ink's choice. `useStdout().write` (Ink's
`writeToStdout`) clears log-update's frame, writes the payload, and re-emits
the cached frame *unconditionally*. It is reachable only from inside the tree,
so the App publishes it into a ref (`AppProps.repaint`) that the owner in
`src/resize.ts` borrows. Ordering is the whole trick: during the storm that
writer would replay a frame laid out for the old width — which is what the
first attempt got wrong — so it runs once, after the settled rerender.

## Invariants

- There is exactly one owner of real-TTY resize rendering.
- Never clear the terminal from a React child without also resetting Ink's
  render instance.
- Never use a fixed Banner row offset: width tiers change physical height.
- A resize storm produces at most one full repaint after it settles.
- **After clearing the screen yourself, never assume Ink will redraw.** Ink
  compares against `lastOutput`, and a resize is free to produce the same
  frame. Force the frame out with `useStdout().write`, and only at the
  trailing edge.
- The settled repaint is a `rerender`, not a relayout: `frameHeight` is read
  from `stdout.rows` during render, so Ink's own resize listener (which
  re-renders the existing tree) could not have refreshed it.
- The alternate screen is always restored during teardown.

## Diagnostic sequence

Run with `DSH_TUI_DEBUG_RESIZE=1`. The trace is written to
`/tmp/dsh-tui-resize.log` and records resize dimensions, debounce settlement,
`instance.clear`, screen clear, `instance.rerender`, and the forced repaint
ordering. Do not infer from a screenshot alone; first compare this event order
with the terminal trace. A trace that ends at `instance.rerender called`
without `repaint written` is the blank-screen case: the App never published
its writer.

`tests/resize-repaint.spec.ts` reproduces both blank-screen drags at the frame
level; `tests/frame-erase.spec.ts` covers the debris the eraser leaves. A fix
that satisfies one and not the other is not a fix.

