# Lessons

Index of bugs that took more than one fix attempt. One row per case; the
linked file is the full investigation note. The consultation protocol
lives in [AGENTS.md](../../AGENTS.md) → "When in doubt".

## When to add a row

Add a row only when **all three** are true:

1. The bug took at least one incorrect fix before the correct one.
2. The fix taught something reusable — an invariant, a diagnostic
   sequence, or a "don't do this again" rule — that a future reader
   couldn't recover from the code or `docs/SPEC.md`.
3. The investigation is closed. Record the resolution, not the chase.

A bug fixed in one clean attempt belongs in git history. A bug still
being investigated belongs in the working tree (untracked). This folder
is for closed cases only.

## Index

| Lesson | One-line takeaway | Tags | Status |
|---|---|---|---|
| [Ctrl-C shutdown](ctrl-c-shutdown.md) | Ink raw mode delivers Ctrl-C as a keypress, not a `SIGINT`; teardown order is `closeUi()` → `ctx.appExit(0)`. | terminal, ink, lifecycle | Resolved · `5f0ae88` |
| [Prompt / scroll snap regression](prompt-scroll-snaps.md) | Timer-driven prompt rerenders can make the terminal alt-screen feel like the chat is snapping to the top or bottom; keep custom cursors stable and low-churn. | terminal, ink, prompt, scroll | Resolved |
| [Message list scroll](message-list-scroll.md) | The mounted window was sliced by entry count while the box clipped by row, so the clipped edge was the bottom and the newest messages were unreachable; anchor with `column-reverse`, measure the viewport, never attach a `data` listener to Ink's stdin, and arbitrate keys two components both want (Ink has no bubbling). | terminal, ink, scroll, layout, input | Resolved |
| [Resize reflow and Ink frame ownership](resize-reflow.md) | A resize must have one owner: debounce outside React, reset Ink with `instance.clear()`, then repaint once in the alternate screen; never mix raw clears with Ink's cached frame — and never assume Ink will redraw after you clear, since it skips a frame identical to `lastOutput`. | terminal, ink, resize, reflow, blank-frame | Resolved |
