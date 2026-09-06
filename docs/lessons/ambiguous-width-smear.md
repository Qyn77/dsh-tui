# Ambiguous-width rows and the stable top-of-frame residue

Status: Resolved

## Symptom

During a long running turn, a stale copy of the StatusBar's top rows stayed on
screen above the live frame — an old `╭` border plus an old status row
(`⠋ … · 96s`) sitting above the current one (`⠴ … · 141s`). The residue was
*stable*: it neither grew nor healed for the rest of the session, and a window
resize cleared it. Intermittent across sessions and hard to reproduce on
demand.

## Root cause

Ink erases the previous dynamic frame with `eraseLines(<logical line count>)`
— the number of `\n`-separated rows in the frame *string*. That count only
describes the screen while every row's **physical** width equals its **laid
out** width. The two diverge on East-Asian *ambiguous* characters: `·`
(U+00B7), the braille spinner (U+2800–28FF), `⏵`, `▌`, `…`, `◆` all count as
**one** column to the layout (Ink's `string-width`) but render as **two** in
the terminals many CJK users run (iTerm2's "ambiguous characters are
double-width", Terminal.app's CJK handling, most terminals with a Chinese
locale).

The full-bleed chrome rows are laid out border-to-border with a single column
of slack, so three ambiguous glyphs in the status row (`· ⠋ ·`) push the right
border past the last column. The terminal wraps the surplus onto the next
physical row; the frame now occupies more physical rows than the string has
logical ones; every subsequent `eraseLines` comes up short by exactly that
surplus; and the top of the old frame survives *every* frame from then on.
One wrapped row leaves a one-row residue, two leave two — the screenshot's
`╭` + status row is two.

Reproduced mechanically by replaying a captured pty stream through a VT
emulator that counts the ambiguous set as double-width: the clean capture
produces the exact screenshot. The onset correlating with turn length is the
token counters growing — but any frame with the ambiguous glyphs in a
full-width row is eligible; the timing is coincidence, not cause.

## Resolution

`index.ts` now disables the terminal's autowrap (DECAWM, `ESC[?7l`) for the
app's lifetime, alongside the alternate-screen and scroll-mode requests, and
restores it (`ESC[?7h`) on every exit path. With autowrap off, a too-wide row
cannot wrap: glyphs printed past the last column overwrite it, and since a
chrome row's final glyph is its right border, the row still reads intact —
the surplus eats trailing padding, not structure. The residue becomes
mechanically impossible regardless of which characters a given terminal
renders wide, because no frame row can ever occupy more physical rows than
the string has lines.

The alternative — measuring the ambiguous set as double-width in
`src/width.ts` — fixes our own arithmetic but not Ink's internal layout, and
Ink pads every box row to its full width, so the border would still land past
the margin. Detection (a CPR cursor-position probe at boot) would tell us
which metric the terminal uses, but cannot change Ink's layout engine, so the
clipping behaviour of `?7l` is the only complete repair.

## Invariants

- A frame row must never wrap in the terminal; autowrap stays off for the
  app's lifetime and is restored on every exit path.
- `eraseLines` bookkeeping is only sound while physical rows equal logical
  lines — treat any source of divergence (wrap, reflow, external writes) as a
  rendering bug in its own right, not as noise.
- SPEC §1 rule 7's "no rendered line may exceed the terminal width" is now
  enforced by the terminal mode rather than by layout discipline alone: the
  layout can be wrong by a few columns (it cannot know the terminal's
  ambiguous-width policy) and the frame must still not corrupt.

## Diagnostic sequence

Capture the pty stream (`script -q /dev/null`, or node-pty with fixed
rows/cols) and replay it through a VT emulator, once with ambiguous
characters narrow and once wide. A clean-when-narrow, smeared-when-wide
capture is this bug; a smear in both replays is one of the other
erase-desync families (see [resize-reflow](resize-reflow.md) for those).
