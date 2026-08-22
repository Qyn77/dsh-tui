# Message list scroll: entries versus rows

## Summary

The conversation could not be scrolled, and the newest messages could not
be reached at all. Four independent defects were stacked behind that one
symptom, and only one of them was arithmetic. The unit that broke it was
**entries versus rows**: the mounted window was sliced by entry count
while the box clipped by row.

## Symptom

On a 40-row terminal with ten completed turns (20 entries), the screen
stopped somewhere around turn 4 and no keystroke reached turn 10. `PageUp`
and `PageDown` had exactly two effects: stuck at the tail, or jumped to
the very first entry. `Home` and `End` did nothing at all, though both
READMEs documented them.

## Root cause

Four defects, each sufficient on its own to look like "scrolling is broken":

1. **Entry-count window, row-based clip.** `MessageList` mounted the last
   `PAGE_ROWS = 12` *entries* and let a `overflow: "hidden"` box clip
   whatever did not fit. The box was top-anchored, so the edge that got
   clipped was the **bottom** — the newest messages were laid out, then
   thrown away. Mounting *more* entries made it worse, not better.
2. **One constant for two jobs.** `PAGE_ROWS` was both the scroll step and
   the window size, so with ≤12 entries a single `PageUp` landed on
   `entries[0]`. That is the two-state behaviour reported in
   [the prompt/scroll snap lesson](prompt-scroll-snaps.md) — which, read
   back now, was diagnosed one layer too high: the timer churn was real,
   but the "only two states" symptom was this.
3. **`Home` / `End` were dead code.** They were compared against a string
   containing a literal ESC byte, and Ink never delivers that: its
   `useInput` blanks `input` for every key in `nonAlphanumericKeys` and
   publishes no flag for `home`/`end`, so by the time a handler sees the
   keystroke it is indistinguishable from noise.
4. **The banner stayed in the live frame.** 19 rows of brand splash
   remained inside the `rows - 3` dynamic frame after the conversation
   started, squeezing the list to a handful of rows. Inside the alternate
   screen there is no scrollback for those rows to scroll into, so the
   banner has to yield once there is a message to head.

Plus a magic number: the viewport was `stdout.rows - 8`, and the real
chrome is 3 (StatusBar) + 4 (prompt) + 3 (frame reserve) + banner.

## Why the first instinct was wrong

The tempting fix is to widen the window — mount 50 entries instead of 12.
That changes nothing, because the clip is at the bottom: more entries just
means more rows discarded off the bottom edge. The diagnostic that settled
it was to stop reasoning and **render**: a probe that renders the real tree
against a fake TTY and prints the frame showed the newest entry absent
from the output, which no amount of reading the offset math would have
shown.

Two further wrong turns, both found the same way:

- `justifyContent="flex-end"` is the obvious way to anchor content to the
  bottom of a clipping box. In Ink 5.2.1 it **drops alternate rows**: a
  4-row viewport over 8 rows of content renders rows 1, 3, 5, 7. Use
  `flexDirection="column-reverse"` instead.
- SGR mouse tracking (`?1000h` + `?1006h`) is the obvious way to get the
  wheel, and it was shipped that way for exactly one round of use before
  the first thing the user tried — dragging to select a reply — stopped
  working. An application that receives clicks takes selection away from
  the terminal, and no amount of "hold `Option`" documentation makes that
  an acceptable default: copying a transcript is most of what a chat log is
  for. xterm's **alternate scroll mode** (`?1007h`) is the right primitive:
  the terminal answers a notch with `↑`/`↓` and never stops owning the
  pointer. Reach for mouse *reporting* only when the application genuinely
  needs the pointer, not merely the wheel.
- The hint row ("↓ N more rows below") was rendered only while scrolled.
  That makes the viewport one row shorter at the moment you start
  scrolling, so `PageDown` sizes its step against a different height than
  the `PageUp` it should undo, and paging left a one-row residue. The row
  is now reserved unconditionally.

## Correct fix

- Offset counts **rows above the newest row**. `0` follows the live tail.
- Tail-anchoring is structural, not measured: an outer
  `flexDirection="column-reverse"` box with `overflow: "hidden"`, and the
  inner column carrying `marginBottom={-offset}`. At offset 0 this needs no
  measurement at all to keep new output on screen.
- Viewport and content heights are **measured** with `measureElement` and
  reported back to `useMessageListScroll`, which is what makes the top of
  the log an exact stop rather than an estimate.
- The mounted window (`windowStart`) is still an estimate, and that is
  fine: it only decides *how many entries to mount*, always reaches the
  newest entry, and under-counting rows is the safe direction because it
  mounts more.
- `Home` / `End` read the **raw chunk** from Ink's own stdin event emitter
  (`useStdin().internal_eventEmitter`), ahead of Ink's normalisation.
- The wheel comes in as `↑`/`↓` via alternate scroll mode, which also gives
  keyboard row-at-a-time scrolling for free. The SGR parser stays, so a
  terminal that reports mouse events anyway still scrolls instead of typing
  the report into the prompt.
- The banner renders only while the log is empty.

## Invariants to keep

1. **Never mix units between the window and the clip.** If the box clips
   by row, the window is chosen by row.
2. **Do not attach a `data` listener to Ink's stdin.** Ink 5 reads input
   with a `readable` listener plus `stdin.read()`; a `data` listener
   switches the stream to flowing mode and drains chunks out from under
   that read loop, which breaks typing entirely. Use
   `internal_eventEmitter`'s `input` event — the same chunk, no flow
   change, and it is what Ink's own `useInput` consumes.
3. **Build control characters, never quote them.** `scroll.ts` uses
   `String.fromCharCode(27)`. An invisible ESC byte pasted into source is
   precisely how `input === '<ESC>[H'` looked correct while never matching,
   and how a test can assert both `undefined` and `'home'` for what reads
   as the same string. `grep -n "$(printf '\033')" <file> | cat -v` is the
   diagnostic (`cat -A` is not available on macOS).
4. **A viewport that changes height while you scroll makes paging
   non-invertible.** Reserve conditional chrome.
5. **Never take the pointer from the terminal for a feature the keyboard
   can serve.** Mouse reporting disables click-to-select; a wheel is not
   worth a transcript you cannot copy.
6. **Layout claims about Ink get measured, not assumed.** Render the tree
   against a fake TTY and read the frame; `tests/message-scroll.spec.ts`
   keeps that check permanent. A fake **stdin** that only emits `data`
   delivers nothing — queue the chunk and hand it out from `read()`.

## Related files

- `src/scroll.ts`, `tests/scroll.spec.ts`
- `src/hooks/useMessageListScroll.ts`
- `src/components/MessageList.tsx`, `tests/message-scroll.spec.ts`
- `src/renderer.tsx` (banner condition, reserved hint row)
- `src/index.ts` (alternate scroll mode enter/exit)
