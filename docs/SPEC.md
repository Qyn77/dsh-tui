# dsh-tui Specification

> Authoritative design contract for `@deepseek-ai/dsh-tui`. Three parts:
>
> 1. **Style** — what "Claude Code CLI style" means here, in concrete terms
> 2. **Roadmap** — what we shipped, what we will ship
> 3. **Conventions** — rules contributors must follow
>
> Living document. Edit it in the same PR that changes the code.

---

## Part 1 · Style

The terminal is the canvas. The goal is the closest possible analog to Claude Code's REPL — single screen, dense with text, keyboard-first — while remaining a pure Cordis bundle with no Host, HTTP, or browser layer.

### 1.1 Layout — three zones, top to bottom

```
┌─ StatusBar ─────────────────────────────────────────────────┐
├─ MessageList ────────────────────────────────────────────────┤
├─ Prompt ─────────────────────────────────────────────────────┤
```

Each zone has a fixed role and stays in that role forever:

- **Banner / StatusBar** — the top zone. The session opens with the **Banner**: a two-column brand splash. The left column is the pixel-art whale, framed by a blank row above and below, with the slogan `探索未至之境！` centered under it. The right column is the block-letter `DEEPSEEK` / `HARNESS` wordmark. The four meta facts are **split across both columns**, not stacked in one: the left carries *where am I* (`<session id> · v<version>`, `<cwd> (<branch>*)`) and the right carries *what and how* (`provider/model`, the tip line). The split exists because both columns are the same height above the meta block — the slogan leaves the left column with empty rows while the right column would otherwise carry four lines alone. In a real TTY the banner is part of the alternate-screen frame and is redrawn with the settled resize; non-TTY tests use Ink's `<Static>` for deterministic output. The compact **StatusBar** takes over as the live header as soon as there is a message to head, carrying the same identity in two rows plus the live token counts and run state. `/clear` empties the view and prints a fresh banner.

  **Three width tiers**, chosen by `bannerTier(columns)`:

  | Tier | Columns | What renders |
  |---|---|---|
  | `full` | ≥ `BANNER_MIN_WIDTH` (76) | Whale + wordmark side by side, meta split across both |
  | `wordmark` | ≥ `BANNER_WORDMARK_WIDTH` (45) | Wordmark + slogan, meta stacked beneath |
  | `plain` | anything narrower | `▄█▀▀█▄ DEEPSEEK HARNESS` on one line, meta stacked |

  Three tiers rather than two because the drop from the full spread to a single text line is a 31-column cliff, and in that band the wordmark still fits perfectly well on its own — it is the half that carries the product's name, so the whale is the half that goes. Every tier keeps all four facts; only decoration is spent.

  **Height is the second axis, and it has a floor the width axis does not.** `bannerTier(columns, availableRows)` also compares the chosen tier against `BANNER_ROWS` — `full` 19, `wordmark` 21, `plain` 10 — and degrades when it will not fit. Two consequences that read as mistakes and are not:

  - **The height fallback goes straight to `plain`, never one tier at a time.** `wordmark` is *taller* than `full`: dropping the whale moves the meta facts out of the second column and stacks them. Narrower does not mean shorter.
  - **There is a fourth tier, `none`, which draws nothing.** A terminal can always give the banner one column of something, but it can genuinely have zero rows to spare — the prompt and an open palette have first claim. Drawing a short banner anyway would not clip it; a subtree taller than the frame overlaps what is beneath it, and what is beneath the banner is the prompt.

  The budget is the App's to compute, because only the App knows what else is in the frame: `bannerRowBudget` is the terminal height less the prompt box, the message list's placeholder row, Ink's reserved row, and whatever the prompt reports through `onOverlayRowsChange` (§1.6). An empty session is the case that needs this — it has no message list to scroll, so it gets no `frameHeight` cap at all, and the banner is the one subtree that can push the frame past the terminal on its own.

  Seven rules make the banner tidy, and each was learned by getting it wrong:

  1. **The whale is a bitmap, not a string of block characters.** A terminal cell is roughly twice as tall as it is wide, so art drawn one-cell-per-pixel comes out vertically stretched and unreadable. `WHALE_BITMAP` is a 28×16 pixel grid and `encodeBitmap` packs each *pair* of pixel rows into one text row (`█` both set, `▀` top only, `▄` bottom only, space neither) so the pixels end up square. A consequence worth remembering: a feature that must read as a clean hole — the whale's eyes — has to sit on a single pixel-row *pair*. Split across two pairs it encodes as `▀▀` above `▄▄` and reads as teeth.
  2. **Every meta line is one pre-composed string in one `<Text>`.** A row built from several `<Text>` children lets Ink wrap mid-word; that is what once rendered `/help` as `/hel` and `/status` as `/stat`. `metaText` returns the four facts unfitted and each column truncates with `fitTail`, which cuts from the *front* (`…top/dsh-tui`) because paths and session ids carry their identity in the tail.
  3. **Both columns pin an explicit `width` and stay shrinkable.** Pinning is what makes the art land at its designed size; a flex column with no width takes it from its widest child, and a squeeze then re-wrapped the meta text onto extra rows and slid every row below it (the observed failure was `tui-132fee32 ·` and `v0.1.0-rc.7` on two lines, the path line pushed out of the frame, the model name clipped mid-word). But pinning the width and *also* setting `flexShrink={0}` was the wrong cure: it converted a squeeze into an **overflow**, which is strictly worse (rule 7). Rule 4 already fixes the row count, so the columns are free to shrink and clip.
  4. **Every `<Text>` in the banner sets `wrap="truncate"`.** The tier arithmetic should mean nothing ever overflows, but a banner whose row count depends on that arithmetic being right is a banner that shatters when it isn't. Truncation makes the height fixed by construction: the worst case is a clipped tail at the right edge, never a reflow.
  5. **Centering CJK text requires `displayWidth`, not `.length`.** The slogan is Chinese, so every character occupies two terminal columns. `centerText` measures in display columns and floors an odd remainder, so the text leans left rather than off the edge; a string wider than the field is returned unpadded instead of pushed negative. It centers on the *sprite's* width, not the column's, so it sits under the whale's midline.
  6. **The version is injected at build time, not read at runtime.** `tsdown.config.ts` defines `__DSH_TUI_VERSION__` from `package.json#version`, and `src/environment.ts` guards the identifier with `typeof` so dev and vitest runs fall back to `dev` instead of a `ReferenceError`. The banner can therefore never print a version that disagrees with the package.
  7. **The banner and live frame must share one resize owner, and no rendered line may ever exceed the terminal width.** Ink erases the previous dynamic frame with `eraseLines(<logical line count>)`; a line wider than the terminal is wrapped by the terminal into two *physical* rows, so the count comes up short and the erase leaves the excess on screen. A terminal can also reflow rows already drawn while Ink still tracks logical rows. The real TTY therefore uses the alternate screen and handles resize outside React (`src/resize.ts`, installed by `index.ts`): remove Ink's eager listener, debounce the storm, call `instance.clear()`, clear the alternate screen, call `instance.rerender()` once, and then force the settled frame out through Ink's own `useStdout().write`. That last step is not belt-and-braces: Ink drops a render whose output string equals the frame it last wrote, and `instance.clear()` does not reset that cached string — so after we erase the screen ourselves, a resize that lands on an identical frame (a height-only drag, or a drag that ends where it began) would leave the terminal blank until the next keystroke. The Banner is dynamic in the real TTY so the selected width tier is redrawn as a unit; fake/non-TTY tests retain `<Static>` to pin output deterministically. `tests/banner-frame.spec.ts` and `tests/frame-erase.spec.ts` pin the width and reflow invariants. "Wider than the terminal" includes *exactly as wide as* the terminal, which is why the live frame reserves the last column. See [the resize lesson](lessons/resize-reflow.md) for the failed approaches and diagnostic sequence.

     Testing this needs a **fake TTY stdin**, not just a fake stdout. On a pipe, Ink's `useInput` throws from a passive effect; that abort leaves React's pending state unapplied, including the update `<Static>` uses to mark its items as written — so the banner looks re-emitted on every resize and the component gets blamed for a harness artifact.

     `<Static>` has one cost worth knowing before reaching for it elsewhere: it renders its items, then advances an index in a `useLayoutEffect`, and that re-entrant `setState` flushes React's pending *passive* effects early — where an error thrown is swallowed instead of reaching Ink's error boundary. Ink's own non-TTY failure travels that exact path, which is why the TTY check is now an explicit precondition in `index.ts` (Part 2) rather than something Ink is trusted to report.

  The empty session deliberately has **no** empty-state copy in the MessageList. The banner sits directly above it and its tip line already says how to start; a second hint saying the same thing read as clutter.
- **MessageList** — the session log viewport. Its height is **measured, not
  calculated**: the box flexes into whatever the StatusBar and the prompt leave
  it, `measureElement` reports the result back to `useMessageListScroll`, and
  that measurement is what bounds the scroll offset. The offset counts **rows
  above the newest row**, never entries — the old entry-count window clipped
  its own bottom edge and made the newest messages unreachable (see
  [the scroll lesson](lessons/message-list-scroll.md)). Clipping is
  tail-anchored structurally: `flexDirection="column-reverse"` with
  `overflow: "hidden"` and a negative `marginBottom` on the inner column, so
  new content follows the live tail with no measurement at all until the user
  scrolls into history.

  | Key | Action |
  | --- | --- |
  | `↑` / `↓` | One row |
  | `PageUp` / `PageDown` | One viewport, less two rows of overlap |
  | `Ctrl-B` / `Ctrl-F` | The same, without reaching for `Fn` |
  | `Ctrl-U` / `Ctrl-D` | Half a viewport (`Ctrl-U` only while the prompt is empty — §1.6) |
  | `Home` / `End` | Oldest row / back to the live tail |
  | Wheel | Delivered as `↑` / `↓` — see below |

  **The wheel must not cost click-to-select.** `index.ts` asks for xterm's
  alternate scroll mode (`?1007h`) alongside the alternate screen, and turns it
  off in the same `finally`. Full mouse tracking (`?1000h` + `?1006h`) was
  tried first and reverted: once the application receives clicks and drags, the
  terminal's own selection stops working, and copying a transcript needs
  `Option` (iTerm2) or `Fn` (Terminal.app). Selecting output to paste elsewhere
  is most of what a chat log is for. Under alternate scroll the terminal
  answers a notch with cursor keys, which cost almost nothing: the prompt only
  claims `↑`/`↓` while its slash palette is open or its buffer occupies more
  than one row (see §1.5), and the paging keys are never negotiable, so the
  whole log stays reachable no matter what the prompt is doing.
  A terminal that ignores `?1007` keeps its own wheel behaviour and the
  keyboard still reaches every row. `useMessageListScroll` also still
  understands SGR reports, so a terminal configured to send them scrolls too.

  When prompt history lands (v0.2) it takes `↑`/`↓` back on a single row too,
  and the wheel will need a different answer than cursor keys.

  One row directly under the list is reserved unconditionally for the
  "scrolled into history" hint. Reserving it while at the tail looks like
  waste and is not: a row that appears only once you scroll changes the
  viewport height at that moment, so `PageDown` would size its step against a
  different height than the `PageUp` it is meant to undo.
- **Prompt** — the input box, always at the bottom. It is one row while the
  buffer fits on one, grows with the buffer up to
  `MAX_PROMPT_ROWS` (10), and past that scrolls inside itself with the caret
  always in view. The cap is what keeps a long paste from pushing the
  conversation off the screen.

  The buffer is folded to rows by `prompt-layout.ts`, not by `<Text>`'s own
  wrapping: Ink would wrap it for free, but then nothing would know how many
  rows the result occupies or which row the caret is on, and both are needed
  to cap the height and to scroll. The fold width is *measured*
  (`measureElement` on the text column), the same pattern the MessageList
  uses. A one-column scrollbar is reserved unconditionally on the right,
  blanks included — a bar that appeared only on overflow would narrow the
  text at that moment and re-fold every row under the caret. Same reasoning
  as the list's reserved hint row.

  `↑`/`↓` inside a multi-row buffer aim at a remembered **display column**
  rather than carrying the character offset over. Without the memory, walking
  down through a short row clamps the caret to that row's end and the next move
  starts from there, so a caret slides to the left margin over a few rows and
  the way back up never returns to where it began. `moveVertically` takes the
  column as an argument and hands it back unchanged, which is what makes the
  walk reversible; the Prompt tags it with the cursor it was taken from, so any
  other handler invalidates it by simply moving the caret. Columns, not
  characters, because that is what the user sees a caret line up with — one row
  of CJK is half as many characters as a row of ASCII at the same width.

**The live frame reserves the terminal's last column.** `App`'s root box carries `marginRight={1}`, and that single column is the other half of rule 7 — the half that applies to everything Ink *does* redraw. Ink stretches the root to the full terminal width, so a framed child emits lines *exactly* as wide as the terminal, and a line that fills the last column leaves the terminal with a wrap decision that terminals do not answer the same way: park the cursor in the last column and let the following newline move down one row (the VT100 reading), or wrap at once so that newline lands a row further down. Under the second reading a 3-row prompt box occupies six physical rows while Ink erases `eraseLines(<logical line count>)` = four, so **every redraw leaks two rows** — which is what a window drag looked like in practice: a ladder of half-drawn prompt boxes, each one column narrower than the last, exactly like the banner ladder that came before it. One reserved column is unwrappable under either reading and also absorbs a one-column lag between `SIGWINCH` and the write, which is what a fast drag does to `stdout.columns`.

**A subtree may not outgrow the frame.** The live frame is a box of fixed height, and Yoga overlaps rather than scrolls whatever does not fit: the surplus rows are drawn over the rows already laid out, so the frame comes back with two things printed on one line and Ink's `eraseLines` count no longer describing what is on screen. Every zone therefore sizes itself against the viewport — the message list scrolls (§1.1), the prompt caps at `MAX_PROMPT_ROWS`, the floating palette windows to `paletteWindowRows(stdout.rows)` (§1.5.1), and the banner degrades its tier — to nothing, if it has to — against `bannerRowBudget` (§1.1). A new zone whose height is driven by data owes the same.

Sizing against the viewport is not enough on its own: two zones that each fit can still overflow *together*. The banner and the palette sit at opposite ends of a frame neither can measure, so they negotiate through the App the same way the shared keys do (§1.6) — the prompt reports the floating list's height upward, the App subtracts it from the banner's budget. Any future pair with the same shape owes the same negotiation rather than a second independent cap.

**A settled resize repaints the screen.** Terminals may reflow rows already drawn while Ink still tracks logical rows, so cursor-relative erasure cannot be made reliable during a resize storm. The real TTY uses the alternate screen and one owner for resize (`src/resize.ts`): after 120ms of quiet it calls `instance.clear()`, clears the alternate screen, calls `instance.rerender()` exactly once — a rerender rather than a relayout, because `frameHeight` is computed from `stdout.rows` during render — and then repaints through Ink's `useStdout().write`, which re-emits the frame whether or not Ink considers it changed. `tests/resize-repaint.spec.ts` pins the blank-screen cases. The primary screen and shell scrollback are restored on exit. See [the resize lesson](lessons/resize-reflow.md).

`tests/frame-erase.spec.ts` pins both halves by replaying a real six-step drag through a small terminal emulator, under both wrap readings **and** with reflow on and off. All four must end with exactly one prompt on screen, and the surviving row must be a whole one. Without the reserved column the immediate-wrap readings leak; without the repaint the reflowing readings end with six prompt rows, which is the reported bug reproduced. Counting the placeholder rather than the `╭` border is deliberate: under reflow a debris row and the frame drawn beneath it can arrive as one copied line, so borders undercount. The file also measures the StatusBar — the live frame's other framed child, and the one doing its own width arithmetic — from 120 columns down to 20.

No modal overlays. No sidebars. No tabs in v0.x. The whole screen is the chat. The terminal's resize event is the only thing that changes the layout.

### 1.2 Box-drawing vocabulary

| Element | Border | Why |
|---|---|---|
| Banner | `round` `#4D6BFE` | Startup splash; brand blue frames the art. |
| StatusBar | `round` `#4D6BFE` | Persistent chrome in the same brand blue as the banner above it. |
| Prompt | `round` (`╭─╮│╰─╯`) | Affordance for an empty input. Cyan when it takes input, gray when it does not (a `!` command, a pending approval). A running turn leaves it cyan — the line steers, §1.6. |
| Tool call | none | A marked line, not a block; see the gutter below. |
| User message | `round` `blue` | The transcript's only marker of authorship. Same box as the prompt, deliberately: what the user typed and where they type it are one surface. |
| Assistant message | none | Floats freely. |
| Note / compaction / plan | none | Single lines, prefixed with `⤷`. |

Frames are reserved for **persistent chrome** — the status bar and the prompt — plus exactly one thing in the conversation: the user's own messages.

That exception is a reversal, and it is worth saying why it does not reopen the tool-call card. A framed entry costs two rows and four columns, and the question is always what that buys per entry *and how many entries pay it*. Tool calls are most of a transcript — five or ten a turn — so their frame was paid over and over for something the `⏺ Name(subject) ✓` line already said, and rc.7 dropped it. A user message is one entry per turn, and before the frame it was the only kind with **no** marker of authorship at all: an assistant turn announces itself with a magenta `Assistant (turn · step)` header, a tool call names the tool, a note carries `⤷` — a user line had two cells of `>` and nothing else. The frame is the answer to "which of these did I say", and there is one of it per turn to pay for.

Only the user's side is framed. An assistant turn renders as markdown and a fenced code block already draws its own `round` box, so a frame around the turn would be a box inside a box — four columns narrower for the code that needs the width most.

**The conversation is a glyph gutter.** Every entry renders as a fixed two-cell marker column beside a body column, the frame around a user message included — the box sits in the body column and the `>` stays in the gutter, so the conversation's left edge is one column for every entry kind: `⏺` for an assistant turn or a tool call, `>` for a user line, `⎿` for a tool's outcome hanging under its call, `⤷` for a lifecycle note. The two-column form is what gives wrapped text a hanging indent — a long turn continues under the body, never back under the marker — and it keeps the conversation's left edge on one column regardless of what an entry is. Entries are separated by a single blank row, applied as a top margin so a tool's outcome stays welded to the call above it.

A tool call is **one line**, `Read(src/scroll.ts) ✓`, with a preview of its result hanging beneath. It was a `round`-bordered card through rc.7: four rows of frame before any content, and two columns of extra indent for everything inside it. A transcript is mostly tool calls, so their per-entry overhead is what decides how much conversation fits on screen — the card cost more than it explained. Which argument becomes the subject in `Name(subject)` is chosen by convention (`file_path`, `command`, `pattern`, …) rather than by tool name, because this package does not own the tool registry and cannot enumerate it.

**Output is previewed, at most `PREVIEW_MAX_LINES` (8) rows.** The result of a tool call and the captured output of a `!` escape are drawn the same way: blank lines dropped, the first 8 remaining lines shown at their own indentation, and a `… +N lines` marker when anything was withheld. One line collapsed to one line was too little to read — a diff or a file listing said nothing — and a shell command that printed a large file used to be painted in full, which pushed the prompt and everything above it off the top. Both failures are the same missing cap.

Every row of a preview is drawn `wrap="truncate"`, and that is not a cosmetic choice: it makes the preview's height equal to its line count, independent of the terminal's width and of the interface language. That is what lets `estimateEntryRows` charge `lines + (hidden ? 1 : 0)` exactly rather than estimating, and what lets the withheld count be translated (§3.10).

**Expanding is global, never per entry.** `/verbose` and `Ctrl-O` (§1.5.6, §1.6) flip one flag that raises the budget from `PREVIEW_MAX_LINES` (8) to `EXPANDED_MAX_LINES` (200) for the whole transcript at once. There is still no per-entry `▾ show more`, and that is the same refusal as before: reaching *one* entry to expand needs a focus/selection model, which is precisely the app-level state machine the roadmap warns against (roadmap §6). A global switch needs no such model, so it is the version that ships.

The raised budget is a bigger cap, not the absence of one. `windowStart` keeps a minimum number of entries mounted whatever they cost in rows, so an uncapped preview means tens of thousands of Ink `Text` nodes laid out every frame. The flag also lives in `useMessageListScroll` rather than beside the other App state, because it is that hook's `reportGeometry` re-clamp that makes a height change safe mid-scroll — the flag and its consequence share an owner.

One known cost: toggling while scrolled into history moves the text under you. The offset counts rows from the bottom, and expanding adds rows below your position as well as above it. Holding position would need the per-entry anchor this design is avoiding.

The glyphs, the gutter width, the columns the user message's frame takes (`USER_FRAME_COLUMNS`), the one-line summaries, and the preview arithmetic live in [`src/message-layout.ts`](./../src/message-layout.ts) as pure functions, and `src/scroll.ts` reads them to estimate how many rows an entry costs. That sharing is load-bearing: the estimate decides how much history stays mounted, and an estimate that *over*-counts stops the mount short of the offset the user is scrolling to, which puts the oldest entries out of reach. The frame is the current example of why the constants are shared rather than written twice — it costs two rows *and* narrows the text that wraps inside it, and an estimate that charged the rows but not the columns would under-count every message long enough to wrap.

**The prompt cursor.** Ink hides the terminal cursor while in raw mode, so the Prompt renders its own. A stable `▌` (LEFT HALF BLOCK, `cyan` bold) sits at the end of the input whenever the prompt is active. During a running turn the cursor disappears, so a locked prompt never visually invites input. The placeholder switches to `… working` in the same step.

### 1.3 Color palette

The palette is theme-aware, and almost entirely by *not* being theme-aware. Nearly every color below is a **named ANSI color** — `gray`, `cyan`, `yellow`, `magenta` — and a named color is resolved by the terminal from the palette its user configured against their own background. Those adapt already, and better than this app could: remapping them would override the choice the user made. So the theme (§1.9) touches only the colors that name an absolute value and therefore cannot adapt on their own: the syntax-highlighting theme, and the *lighter* brand blue. `NO_COLOR` disables color entirely.

| Role | Color | Where |
|---|---|---|
| DeepSeek brand blue | `#4D6BFE` | Banner whale + `DEEPSEEK` wordmark; Banner/StatusBar border; tip keys; StatusBar `dsh`. One value, not a pair: it measures 4.83:1 on black and 4.35:1 on white, so it is legible on either. |
| DeepSeek blue, light | `#9BADFF` dark / `#3B4FA8` light | `HARNESS` wordmark; the whale's belly row; the banner's tip line. The one *pair* in this table. `#9BADFF` measures 2.14:1 on white — it fails there, which is the bug the theme exists to fix; the light variant is the same hue walked down until it clears 4.5:1. |
| App brand | `cyan` bold | `>` in the prompt; slash palette border and command names. |
| Model name | `green` | `provider/model` in the StatusBar. |
| Model name — banner | default fg, bold | `provider/model` on the banner. Deliberately uncolored: this is the line the banner most needs legible, and every *named* color is a palette entry the terminal resolves against its own background. `white` is the one that fails worst — on a light-background terminal it lands near the background and the line all but vanishes. The default foreground is the only color guaranteed to contrast, because contrast is the job the terminal picked it for. Same reasoning as **Command output** below. |
| User marker + frame | `blue` | `>` in the gutter of a user line, and the `round` box beside it. |
| Assistant marker + label | `magenta` bold | `⏺` in the gutter; `assistant` in the metadata header. |
| Tool name | bold | The `Name(subject)` line. |
| Tool marker + status — ok | `green` | `⏺` on the call line; `✓`. |
| Tool marker + status — running | `yellow` | `⏺` on the call line; `…`. |
| Tool marker + status — error | `red` | `⏺` on the call line; `✗`; the `⎿ Name: code` row. |
| Tool marker + status — cancelled | `gray` | `⏺` on the call line; `⊘`. The turn ended while the call was in flight — not a failure, so never red. |
| Tool result | `gray` dim | The `⎿` row under a call. |
| Run state — idle | `gray` | StatusBar status glyph. |
| Run state — running | `yellow` | StatusBar status glyph. |
| Streaming | `yellow` | `· streaming` suffix on the assistant block. |
| Compaction | `cyan` dim | `⤷ compacting…` lines. |
| Command echo | `cyan` | `⤷ /help` — the command line the user ran, echoed in the log. Same `cyan` as the palette's command names. |
| Command output | default fg | The command's own text under the echo. Never dimmed: it is content the user explicitly asked for, and `gray dim` makes the `/help` table hard to read on a light terminal. |
| Command failed | `red` | Both rows of an unknown command. |
| Plan mode on | `yellow` | `⤷ plan mode on`. Emitted by `@deepseek-ai/dsh-plan-mode`; `src/types.ts` declares the payload locally so the TUI builds and draws it without depending on that plugin. |
| Plan mode off | `gray` | `⤷ plan mode off`. |
| Meta / separators | `gray` | `·`, `in:`, `out:`, `session:`, turn/step counters. |
| Notes | `gray` dim | Free-floating side remarks. |
| Note — turn failed | `red` | `⤷ [turn N errored: CODE]`. Full brightness: left dim it read as an incidental remark. |
| Note — turn stopped | `yellow` | `⤷ [turn N interrupted]`, `⤷ [turn N aborted]`. |
| Version / repo meta | `gray` | `v<version>`, `<cwd> (<branch>*)` on the banner. |

Colors are semantic, not aesthetic. Don't introduce new colors without a reason in this spec.

### 1.4 Status glyphs

| State | Glyph + label | Color |
|---|---|---|
| Idle | `⏵ idle` | `gray` |
| Running | `⠋ working · 3s` (spinner + elapsed seconds) | `yellow` |
| Awaiting approval | `? approve` | `yellow` |
| Cancelled | `⊘ cancelled` | `gray` |

The running indicator is driven by [`useRunningClock`](./../src/hooks/useRunningClock.ts): a single 80ms interval ticks the spinner through the Braille frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` and updates the elapsed-seconds counter only when the integer second changes (so a long turn does not re-render at 12 fps for a value that has not moved). Both the StatusBar status slot and the Prompt's `… working` placeholder read from the same frame index, so the glyph stays in lock-step on screen. Idle turns pay no timer cost — the interval is created on the `idle → running` transition and torn down on the reverse.

Glyphs are Unicode. Don't draw them with ASCII (`>` `|`) — the round/single box characters are part of the visual identity.

### 1.5 Slash commands

The only commands in the REPL are slash commands. No flags, no sub-commands, no prefixed shortcuts.

| Command | Effect |
|---|---|
| `Enter` | Send the current input as a user message. |
| `/help` | Print the list of available slash commands. |
| `/clear` | Clear the visible chat. The session log is unchanged. Prints nothing — see below. |
| `/status` | Print the current model and session id. |
| `/plugins` | List the plugins this host loaded, and how each one is doing. `/plugins enable\|disable <name>` switches one. |
| `/usage` | Break this session's token spend out turn by turn. |
| `/theme` | Choose the background the colors assume: `/theme auto\|dark\|light`. Bare `/theme` reports the current setting and, under `auto`, what the terminal answered. |
| `/copy` | Send the newest reply to the system clipboard over OSC 52. `/copy code` sends the newest fenced block instead. |
| `/verbose` | Raise the preview budget from 8 lines to 200 for every entry at once. Bare toggles; `on`/`off` set it. |
| `/sessions` | List the stored sessions, newest first, with the id to resume one by. |
| `/resume` | Switch to a stored session: `/resume <id>`, or `/resume last` for the newest. |
| `/exit`, `/quit` | Leave the REPL. |
| `Ctrl-C` (turn running) | Cancel the in-flight turn. |
| `Ctrl-C` (buffer non-empty) | Clear the buffer. |
| `Ctrl-C` (idle, empty buffer) | Ask; a second `Ctrl-C` is the same as `/exit`. |
| `Esc` (turn running) | Cancel the in-flight turn, without the exit branch. |

Slash commands are case-sensitive (`/exit`, not `/Exit`). A line is a slash command iff it starts with `/` and matches a known name; anything else is sent to the model as a user message.

**Command output is an entry in the conversation, never a write to `stdout`/`stderr`.** The REPL runs inside the alternate screen buffer, where Ink owns every row of the live frame: a direct write lands on rows Ink is driving and is either erased by the next frame or wedged into one. `/help` and `/status` printed to `process.stderr` for exactly this reason and produced nothing a user could read. Output therefore becomes a `command` entry (echoed command line + its text), appended locally by the App — commands never reach the model, so there is no session event behind them and the pure reducer cannot mint one.

A command that has no output prints nothing at all. `/clear` is the case that matters: an entry saying "View cleared." would leave the log one entry long, which contradicts what the user just watched happen *and* suppresses the banner, since the banner renders only on an empty log.

Shipped beyond the v0.1 five: `/language`, `/model <name>`, `/context`, `/plugins`, `/usage`, `/theme`, `/copy`, `/verbose`, `/sessions`, `/resume`. A name this table does not own falls through to `ctx.commands`, the registry where plugins mount their own — `dsh-base` puts `/compact`, `/feedback` and `/goal` there, so those work without this package naming them. `/resume` used to be listed here as future work and now ships (§1.5.8). `/cost` used to be on this list and has been removed: no peer reports a price, so see §3.3.2 rather than reinstating it.

#### 1.5.1 Slash palette

When the buffer starts with `/` and contains no space yet, a `round` cyan-bordered palette floats above the prompt showing the commands whose names start with the buffer (case-insensitive). The first row is selected by default.

| Key | Effect |
|---|---|
| `↑` / `↓` | Move the selection (clamped to the filtered list). |
| `Tab` | Replace the buffer with the highlighted name + trailing space. |
| `Enter` | If the buffer is an exact command name, dispatch it. Otherwise, complete the highlighted name into the buffer (same as `Tab`). |
| `Esc` | Clear the buffer. |
| Any other key | Standard buffer editing. |

The palette disappears as soon as the buffer contains a space (the user is typing arguments, not a command) or as soon as the buffer stops matching any registered command. The selected row is rendered with an inverted `cyan` background so it is unmistakable which command `Tab` / `Enter` will act on. The bottom of the palette shows the key hint `↑↓ navigate · Tab complete · Enter run · Esc dismiss` so the user does not have to memorize the bindings.

Both the palette and `/help` read from a single `COMMANDS` registry in `src/commands.ts`; adding a new command is a one-line change there plus one case in `dispatch`.

**The list is windowed, and the window is sized from the terminal's height.** At most `paletteWindowRows(stdout.rows)` rows are drawn — eight on any terminal with room for eight, fewer on a short one, never zero. The window follows the selection: it sits at the top until `↓` walks past its bottom edge, then moves a row at a time. Whatever is off-screen is counted next to the key hint (`· +7 more`), so the list never silently omits a command. The `@` picker (§1.5.2) draws through the same component and gets the same treatment.

This is a rendering constraint, not a taste one. The App's root box has a **fixed** `stdout.rows - 3` height (§1.1, so Ink stays on log-update's incremental path), and Yoga does not scroll a subtree that overflows a fixed height — it lays the surplus rows on top of the rows already there. With fifteen built-in commands and a 24-row terminal, an uncapped palette needed twenty rows and got twenty-one for the *whole frame*: two commands printed onto one line, the StatusBar's identity row buried under its token row, the prompt box's top border overwritten by its own content. On screen that reads as duplicated, half-drawn debris that survives every subsequent frame — Ink erases `eraseLines(<logical line count>)`, and the count it holds is not the number of physical rows an overlapping layout put there — and disappears the moment a resize forces a full repaint. The palette is the one subtree whose height is driven by *data* rather than by the viewport, so it is the one that has to yield. See `paletteWindowRows` in `src/prompt-layout.ts` and the frame tests in `tests/prompt-frame.spec.ts`.

#### 1.5.2 `@` file picker

An `@` that opens a word turns the token under the caret into a mention, and the same floating box lists the files under the working directory that fuzzy-match what follows it. `Tab` or `Enter` inserts the highlighted path in place of the token, with a trailing space; `↑`/`↓` move the selection; `Esc` closes the list and *keeps the buffer*, because the buffer is a sentence being written rather than a command mistyped.

Three decisions are worth stating, because each has a tempting alternative.

**A mention is completion, not attachment.** Inserting `@src/prompt-layout.ts` puts that text in the message and nothing else: no file contents are read, inlined, or attached. What to feed a model is prompt assembly, which belongs to the harness — a text box that silently expanded one token into eight thousand tokens of file would be making that decision on the harness's behalf, invisibly, and would blow a context window with no way for the user to see it coming. The model has file tools; the picker's job is to hand it a path that resolves on the first try.

**The `@` has to open a word.** `qiao@example.com`, `react@18`, `@types/node` in prose — a picker that fired on every `@` would appear, steal `↑`/`↓`, and change what `Enter` means, in the middle of an ordinary sentence. Requiring whitespace (or the start of the buffer) before the `@` costs nothing a real mention wants.

**The directory is walked once per mention session, not per keystroke.** The obvious shape — scan on each new query — makes a repo-sized walk race itself between `@s` and `@sr`, and the answers can arrive out of order. `useFileMentions` walks once, caches by working directory (so `!cd` invalidates it, per §1.9), and filters in memory afterwards, which also means every keystroke after the first is synchronous. The walk is breadth-first and capped at `MAX_SCANNED_FILES`, so what a cap throws away is the deepest files — the least likely to be meant. While the first walk is in flight the box says so rather than staying invisible, which would read as "the key did nothing".

Ranking (`scorePath`) is a case-insensitive subsequence match with two bonuses: a character matched immediately after the previous one, and a character matched inside the basename. The basename is also scanned as a candidate in its own right and the better of the two attempts wins — without that, a leftmost-first scan spends `scr` on three directory initials and ranks `s/c/r.ts` above `src/scroll.ts`.

The `/` palette wins when both could open: it is anchored to the first character of the buffer, which makes it the more deliberate of the two, and only one of them may own `↑`/`↓` at a time. Both draw through the same `SlashPalette` component — a file row simply has no description — because two bordered lists with the same selection idiom would drift apart on the first visual change made to either.

#### 1.5.3 `/plugins`

`/plugins` prints one row per entry the loader holds: a status glyph, the module specifier, and a translated word for its lifecycle phase. Broken entries sort first, healthy ones next, deliberately-disabled ones last — someone types `/plugins` far more often to ask "why isn't X working" than to ask "what is loaded", and the answer to the first question should not require reading to the bottom of a forty-row table.

**It reads the loader on every invocation and caches nothing.** Cordis already keeps `Entry.fiber` and `Fiber.state` current through its own `internal/plugin` and `internal/status` events, so any table this package kept would be a second copy that can only be more wrong than the first. A plugin that dies an hour into a session shows as failed the next time the command is typed, with no subscription to maintain.

Two hazards the implementation has to name:

**`FiberState` is a `const enum` with no runtime representation.** It cannot be imported and read, so `plugins.ts` mirrors the numbers by hand. If cordis reorders that enum, the mirror is wrong and *nothing fails to compile* — the labels simply lie. The table carries that warning at its definition. A state outside the mirror reports as "not started" rather than guessing.

**The loader is optional.** An embedded assembly can build the context by hand and never mount one; `/plugins` then says so, the same way `/context` degrades when no context window is known. A missing feature is not a crash.

##### Enabling and disabling

`/plugins enable <name>` and `/plugins disable <name>` call `loader.update()`, which both starts or stops the plugin *and* rewrites the loader config on disk. That is a different kind of act from printing a table, and the design is mostly about the cases where it must not happen.

Re-enabling writes `disabled: null`, which deletes the key, rather than `disabled: false`. A plugin switched off and back on leaves the config the shape it was found in.

The target may be an exact config id, an exact module specifier, or a unique case-insensitive substring of one — `/plugins disable tool-fs` should not require typing the scope. Several substring hits are reported as a list rather than resolved by picking the shortest: this writes a config file, and choosing between `dsh-tool-fs` and `dsh-tool-fs-extra` on the user's behalf is exactly the guess that should be a question.

Three rows refuse to be switched, each because writing the flag would destroy something or leave no way back:

- **This package.** Disabling the UI from inside the UI tears down the screen mid-command, and there is then nothing left to type the re-enable into. It is matched by module specifier, because reading `ctx[Entry.key]` would mean a *value* import of the loader and this package imports it as a type only, so that an assembly without a loader still runs.
- **A `!!js` expression.** The loader stores an expression as a node, not a boolean; overwriting it with `true` would silently throw away something the user wrote by hand.
- **A row that is off only because its group is off.** `Entry.disabled` folds in the ancestors, so a row can read as disabled while its own flag is unset. Setting that flag would change nothing visible. The message names the group as the thing to enable.

A plugin already in the requested state is reported and not written — the config file's mtime should mean something.

#### 1.5.4 `/usage`

`/usage` prints one row per turn — billed input, output, and a `(n)` marker when the turn took several assistant steps — under a heading and above a total.

**It is a separate command from `/context` on purpose.** `/context` answers "how full is the window": one number about now. `/usage` answers "where did the tokens go": a history. Merging them would put a table under a gauge and bury the gauge, which is the thing a user checks before deciding to `/compact`.

**Rows are grouped by turn, not listed per step.** One question that takes six tool round-trips is billed six times; the reader asked about the question. The step count survives on the row because it is usually *why* a row is large.

The columns sum to the same figures `/context` reports as cumulative spend, and `tests/usage.spec.ts` pins that agreement — they are two views of one fact, so a disagreement is a bug in one of them. What the table must not be read as is occupancy: each turn's input restates the whole prefix, which is the confusion `contextOccupancy` exists to prevent (§3.3.2).

Past `MAX_USAGE_ROWS` turns the oldest are folded into a single `+N earlier` row **carrying their summed tokens**, rather than dropped. This is the output-preview policy from §1.2 — cap the height, say what was left out — with the extra requirement that the visible rows still add up to the printed total. A table whose own arithmetic does not check out teaches the reader to distrust it.

Both number columns are right-aligned in display columns rather than characters, because the Chinese labels (`轮次`, `合计`) are two characters and four columns wide.

#### 1.5.5 `/copy`

`/copy` writes `ESC ] 52 ; c ; <base64> BEL` to the terminal, which is how a program inside a terminal reaches the *system* clipboard — including across SSH, which is the case that makes it worth having at all. `c` is the clipboard selection rather than `p`, the primary: the point is the paste the user is about to do in another application.

**Two forms, and no third.** Bare `/copy` takes the newest assistant reply; `/copy code` takes the newest fenced block anywhere in the conversation, because "copy that snippet" usually arrives a few turns after the snippet. Anything else prints the usage line rather than guessing — `/copy codee` silently copying the whole reply instead would be discovered on paste, which is the worst place to discover it. There is no `/copy <n>`: naming an older entry needs the focus/selection model §1.2 and roadmap §6 both decline.

What it copies is the reply's **markdown source**, not the terminal's rendering of it. Someone pasting into an editor or an issue wants what the model wrote. `/copy code` reuses `parseMarkdown` rather than re-matching fences, so the block it sends is byte-for-byte the one §1.9 drew.

**The write is never acknowledged, and every message says so.** OSC 52 has no reply. A terminal that does not implement it, or a tmux without `set-clipboard on`, discards the sequence in silence, and the app cannot tell that from success. So the confirmation states what was *sent* — the target and its byte count — and names the one thing the user can check if nothing pastes. Reporting "copied" would be a claim the app has no basis for.

**Under tmux the sequence is wrapped in DCS passthrough with every inner `ESC` doubled.** That doubling is the whole difference between working and doing nothing: tmux's passthrough ends at the first `ESC \`, so an undoubled escape terminates the DCS early. Detection is `TMUX`, not `TERM` — `TERM=screen-256color` is what tmux itself usually reports. GNU `screen` is deliberately **not** handled: its passthrough needs the payload split into 512-byte chunks, and a half-right implementation would fail on exactly the large copies the chunking exists for, while looking supported.

**The payload is capped at `OSC52_MAX_BYTES` (48 KiB, 64 KiB of base64) and the truncation is reported.** No specification states a limit and implementations differ; a sequence a terminal considers too long is dropped without a word. An uncapped `/copy` would therefore report success and copy nothing on exactly the large replies where it matters. This is the same cap-and-say-so policy as the output preview (§1.2), with the cut measured in UTF-8 bytes and pulled back to a whole code point.

**The bytes go through Ink's writer, not `process.stdout`.** An OSC 52 sequence is invisible and moves no cursor, so a raw write would usually be harmless — but a terminal that does not recognise it prints the tail as text, and Ink's writer re-emits the cached frame immediately afterwards, so that debris is erased on the spot. Same mechanism as Ctrl-L (§1.6).

**There is no `/paste`, and that is a constraint rather than a gap.** Reading the clipboard needs the query form and a read of the reply, which needs a `data` listener on stdin — mid-session, while Ink owns the read loop. `probeAppearance` (§1.10) gets away with that only because it runs before Ink mounts; there is no equivalent window once a session is up, and a reply arriving after mount is typed into the prompt as garbage. It is also the less valuable half: every terminal already pastes with its own binding, and bracketed paste reaches the prompt intact (§1.6 — though that last clause was written well before `?2004h` was actually set, and was false for every release until then).

#### 1.5.6 `/verbose`

`/verbose` raises the preview budget from 8 lines to 200 for **every** entry at once (§1.2). Bare toggles; `on` and `off` set it explicitly; anything else prints the usage line with both budgets in it and does not move the switch.

**Bare toggles rather than printing usage, unlike `/theme`.** There are only two states, so a round trip through a usage line to reach the other one is pure ceremony. `/theme` cannot do the same — it has three settings and one of them is a measurement — and the usage line is still reachable here, because it is what a bad argument prints. `on` while already on stays on: a habit that types it twice must not land in the opposite state.

**It is not saved.** `/theme` and `/language` persist because they are preferences about how the app should look; this is a temporary act of reading something, closer to scrolling than to configuring. Restoring it at launch would also mean the first frame of every session is the expensive one.

`Ctrl-O` is the same switch (§1.6), and the command reports the budget in lines rather than the word `on`, because the number is the part the user cannot guess.

#### 1.5.7 `/sessions`

`/sessions` lists the stored sessions newest first — abbreviated id, local timestamp, cwd, and the first thing the human said in each — with the current one marked, and a footer naming the environment variable that continues one at launch.

**It exists because resume did.** `DSH_TUI_RESUME` has worked since v0.3 (§3.3.1) and was unusable: the ids it wants are `tui-<uuid>`, generated at boot and printed nowhere. The feature was complete and undiscoverable, which is indistinguishable from missing. Building the listing was therefore not a new capability but the other half of one already shipped.

**Rows come from `list()`, summaries from `inspect()`.** `SessionPersistence.list()` is a metadata-only read and carries no message text, so a summary costs one `inspect()` per row. That is why the table caps at ten rows and prints `… +N earlier` for the rest: the cap bounds the cost of the command, and a listing longer than a screen would be scrolled past anyway. An `inspect()` that fails leaves that row's summary blank rather than failing the command — a session whose log is unreadable is exactly one the user may want to know exists.

**The summary skips injected context.** The first `user/message` event is often a harness-injected preamble, identical across every session; summarising by it would print ten identical rows. Only events whose source is the human count, and a session with none summarises as blank.

**Ids are abbreviated to twelve characters, and `planResume` accepts a prefix.** The two are one decision: a listing that abbreviates further than resume can resolve would print ids that do not work. See §3.3.1 for the prefix rules and for why an over-wide row is allowed to overflow rather than give up a column.

**Rows are not selectable, and the footer names the command instead.** Selecting one would need a focus model the app does not have — the same refusal `/verbose` is built around (§1.2). Typing `/resume <id>` costs one line and needs no such model.

#### 1.5.8 `/resume`

`/resume <id>` switches the live agent to a stored session; `/resume last` takes the newest. The id is the abbreviated one `/sessions` prints, and the command does no parsing of its own — the request goes to `planResume` verbatim, so a boot and a mid-session switch can never drift into accepting different things.

**A bare `/resume` prints usage rather than acting,** unlike bare `/verbose`. There are not two states to toggle between; the argument *is* the command, and it is not guessable, so the usage line points at `/sessions`.

**What comes back is the transcript, and no count of it.** The App could cheaply report how many session events were replayed, but that number is not the number of rows on screen, and a figure that disagrees with what the user is looking at is worse than no figure. The restored transcript is its own evidence.

**Every refusal leaves the user where they were.** A request that resolves to nothing does not start a fresh session the way a boot does; a target equal to the current session says so; a load failure says the session is intact. See §3.3.1 for the mechanics and for why the running-turn check is depth rather than the main guard.

### 1.6 Keyboard bindings

Ink hands every keystroke to *every* mounted `useInput` handler and offers no
`stopPropagation`. So there is no such thing as a key being "handled" here —
only a convention about which layer is allowed to act on it, enforced by
guards on both sides. This table **is** that convention: an owner acts, and
every other layer must let the key pass untouched. Two layers acting on one
keystroke is a bug, and so is a key the prompt swallows into its text path on
its way to someone else.

| Key | Owner | Action |
|---|---|---|
| printable input | Prompt | Insert at the caret |
| `Enter` | Prompt | Send (or dispatch exact slash command, or complete highlight) |
| `Backspace` | Prompt | Delete the character before the caret |
| `←` / `→` | Prompt | Move the caret one character |
| `Ctrl-A` / `Ctrl-E` | Prompt | Caret to start / end of the buffer |
| `Alt-B` / `Alt-F` | Prompt | Caret back / forward one word |
| `Ctrl-W` | Prompt | Delete the word before the caret |
| `Ctrl-K` | Prompt | Delete from the caret to the end of the buffer |
| `Ctrl-P` / `Ctrl-N` | Prompt | Walk back / forward through submitted lines |
| `Ctrl-J` | Prompt | Insert a newline |
| `\` + `Enter` | Prompt | Insert a newline (the older escape; still works) |
| `Tab` | Slash palette | Complete the highlighted command |
| `Esc` | Slash palette | Dismiss palette and clear buffer |
| `↑` / `↓` | Slash palette | Move palette selection |
| `Tab` / `Enter` | `@` file picker | Insert the highlighted path |
| `Esc` | `@` file picker | Dismiss the list, keep the buffer |
| `↑` / `↓` | `@` file picker | Move picker selection |
| `↑` / `↓` | Prompt (multi-row buffer) | Move the caret one row |
| `↑` / `↓` | MessageList (otherwise) | Scroll one row |
| `PageUp` / `PageDown` | MessageList | Scroll a page |
| `Ctrl-B` / `Ctrl-F` | MessageList | Scroll a page (no `Fn` needed) |
| `Ctrl-U` | Prompt (buffer non-empty) | Delete from the caret to the start of the buffer |
| `Ctrl-U` | MessageList (otherwise) | Scroll half a page |
| `Ctrl-D` | MessageList | Scroll half a page |
| `Home` / `End` | MessageList | Jump to the oldest row / back to the tail |
| `Ctrl-O` | MessageList | Toggle the expanded preview budget (`/verbose`) |
| `Esc` | App (nothing else claims it) | Cancel the running turn or shell; never exits |
| `Ctrl-C` | Prompt (buffer non-empty) | Clear the buffer |
| `Ctrl-C` | App (otherwise) | Cancel turn if one is running; else arm, then confirm, exit |
| `Ctrl-L` | App | Clear the screen and redraw the frame |
| `Enter` (turn running) | Prompt → `agent.steer` | Reach the model at its next step boundary |
| `Enter` (idle) | Prompt → `agent.followup` | Open a turn of its own |
| pasted text | Prompt, **before every row above** | Insert verbatim; newlines normalised to `\n` |

**Paste is not a row in that table so much as a layer above it.** The app sets
bracketed-paste mode (`?2004h`) alongside the alternate screen, so the terminal
wraps pasted bytes in `ESC [200~` … `ESC [201~`. Between those markers every
byte is text *by definition*, and the prompt decodes them before it dispatches
on any key — because inside a paste Ink has already labelled some bytes
`return`, `tab` or `backspace`, and acting on those labels means acting on
keystrokes the user never made.

This is not a refinement. A terminal in raw mode sends a pasted newline as
`\r`, the same byte `Enter` sends, and stdin splits a large paste across
chunks: a chunk boundary landing on a newline arrived as a lone `\r`, which
Ink names `return`, and the prompt **submitted half the message**. Nothing
downstream can distinguish the two — the markers are the only thing that can,
which is the entire reason the mode exists. A terminal that ignores `?2004`
still gets its stray `\r`s collapsed to `\n` (without which they reach the
screen as carriage returns and the pasted lines overprint each other), but the
split-chunk submission is unfixable there: a lone `\r` with no marker around
it is genuinely indistinguishable from `Enter`, and pretending otherwise would
break the `Enter` key to protect a paste. See `src/paste.ts`.

Four rows are decided rather than inherited, and each costs something:

- **`Ctrl-U` kills the line when there is a line, and scrolls when there is
  not.** Neither meaning could be dropped. In readline it is kill-to-start and
  that muscle memory is real; but `PageUp`/`PageDown` need `Fn` on a laptop,
  `Ctrl-B/F/U/D` are what make a long log navigable one-handed, and losing
  half-page scroll is the larger regression. The two never actually collide:
  wanting to erase a half-written line and wanting to page through history are
  different moments, and *the buffer being non-empty is exactly the signal that
  says which moment this is*. So the prompt claims the key while it holds text
  and hands it straight back when emptied — the same `onArrowClaimChange`
  negotiation the arrows use (below), through `ctrlUScrolls`. `Ctrl-D` is not
  negotiable: it is not a readline line-editing key, so there is nothing to
  arbitrate.
- **`Home`/`End` move through history, not through the buffer.** The prompt
  has `Ctrl-A`/`Ctrl-E` for its two ends, so the caret loses nothing; the log
  has no other way to reach the top of a long conversation. `End` is also the
  only way back to the tail after scrolling, which makes it the more load
  bearing of the two meanings. They are read off raw stdin rather than through
  `useInput` because Ink 5 does not decode them.
- **History is on `Ctrl-P`/`Ctrl-N`, not on `↑`/`↓`.** Every shell puts it on
  the arrows and this does not, which is a real cost in muscle memory. It is
  unavoidable: `index.ts` asks the terminal for alternate scroll mode, so a
  *wheel notch* is delivered as a cursor key. Putting history on `↑` would
  mean scrolling the wheel replaces the user's half-written message with an old
  one. The arrows are already negotiated between the caret and the log (below);
  history cannot be a third claimant on them.

  History lives in memory for the session only and holds submitted lines,
  slash commands included — re-running `/status` is a normal thing to want.
  Empty lines and a repeat of the newest entry are not recorded, and edits to
  a recalled line are not remembered per entry: keep walking and they are
  gone, as in `bash`.

- **`Ctrl-O` is free only because Ink holds the terminal in raw mode.** In
  cooked mode it is `VDISCARD` and the tty eats it before any process sees it,
  which is why almost nothing binds it and why it is available here. It sits
  with the MessageList rather than the App because the flag it flips is that
  hook's (§1.2), and because the same hook's geometry re-clamp is what keeps
  the change safe mid-scroll.

**`Ctrl-C` is ordered by what the press would destroy, most recoverable first.**
A running shell command is aborted; failing that, a running turn is cancelled;
failing that, a non-empty buffer is cleared; and only with nothing left to
interrupt does it touch the session — and then it *asks*, arming an exit that a
second `Ctrl-C` confirms and any other key cancels. The middle branch is the
point: one `Ctrl-C` used to close a session over a half-written paragraph,
because the key meant "cancel" when something was running and "quit" the rest of
the time, and the user's own typing was not counted as something. The notice
reuses the hint row already reserved below the prompt, so arming the exit moves
no rows (§1.5.5); the confirm step is the one place in the app where a keystroke
is deliberately not idempotent, which is why it is announced rather than
silent.

**`Esc` cancels a turn but can never exit.** It is the key a user reaches for
when they want the model to *stop*, and until now it did nothing at the App
level, so the only way to stop a turn was the key that also quits. It shares
`handleCancel` with `Ctrl-C` and stops there — it has no exit branch and no
arming step, because a key that cannot close the session does not need a
confirmation. It stands down entirely while an approval is pending: the
approval card binds `Esc` to *deny*, and denials happen mid-turn, so an
unguarded `Esc` would deny the tool and kill the whole turn on one press.

**The prompt stays live while a turn runs, and `Enter` steers it.** The box
used to go inert for the whole turn — `active` was literally
`state.status === 'idle' && !shell.running` — so the only thing a user could do
while watching the model go the wrong way was kill the turn and start over.
`Agent` has had the right call the entire time: `followup()` queues a message
as the sole ordinary message of *its own* turn, which means a correction sent
mid-turn is read only after the model has finished doing the thing being
corrected, while `steer()` is consumed at the next **step** boundary of the
turn already running. The submit path picks between them on `state.status`;
nothing else about submission changes.

Three consequences, each of which had to be paid for:

- **`active` and "a turn is running" are now different flags.** `active` means
  the box takes keys, and only a `!` command or a pending approval closes it.
  `busy` means something is running that `Esc`/`Ctrl-C` would stop. The spinner
  caption is how the user tells the two apart on an empty buffer — `working`
  when the box is closed, `steering` when the turn is running but the line is
  live — because on a *non-empty* buffer the placeholder is gone and the border
  is the only cue left.
- **`Ctrl-C` and `Esc` had to be re-arbitrated**, because each now has a
  claimant on both sides of a keystroke that was previously unopposed. The
  prompt's `Ctrl-C` (clear the line) stands down while `busy`: the press means
  "stop the model", and eating the line as well answers one keystroke twice.
  The App's `Esc` (cancel the turn) stands down while the prompt's palette or
  file picker is open, reported through `onEscClaimChange` — the same
  negotiation shape as the arrows and `Ctrl-U`, and newly necessary only
  because a palette can be open during a turn at all now.
- **Slash commands are refused mid-turn** rather than queued, with a note
  saying so. The refusal is coarse on purpose: `/clear`, `/resume` and `/model`
  reach into the session the running turn is writing to, a plugin-registered
  command can do anything at all, and nothing in the registry says which is
  which. One rule with no unknowns beats an allowlist that is wrong the first
  time a plugin adds a row. A `!` escape is *not* refused — it spawns a child
  process and never touches the agent.

Nothing is echoed locally on submit. A steered line reaches the log the same
way a follow-up does, as the session's own `user/message` event, so it appears
when the agent has recorded it rather than when the key was pressed — and a
line the agent discards (cancellation can drop parked steering) never appears
on screen claiming to have been sent.

**`Ctrl-L` goes through Ink's writer, not through `stdout`.** The binding is one
line, and the obvious spelling of it is wrong: `stdout.write(CLEAR_SCREEN)`
erases the screen and leaves it erased, because Ink drops any frame identical to
the one it last wrote and a redraw request asks for exactly that frame — the
terminal stays blank until the next keystroke. `useStdout().write` clears
log-update's bookkeeping, emits the payload, and re-emits the cached frame
*unconditionally*, which is the same mechanism §`resize.ts` relies on for a
settled drag. `Ctrl-L` changes no state at all — not the buffer, not the scroll
offset — because what it repairs is the terminal's pixels rather than anything
the app believes. The `Static` banner scrolls away with the rest, which is the
bargain a resize already makes; `/clear` prints a new one.

There is also one binding that is *absent* rather than assigned. **Forward
delete (the `Delete` key) is not implemented**, because Ink 5 cannot express
it: `\x7f` — what the `Backspace` key sends — and `\x1b[3~` — what `Delete`
sends — both arrive as `key.delete` with empty input, so a handler cannot tell
which key the user pressed. Implementing it means reading the escape sequence
off raw stdin, the same hatch `Home`/`End` use. That is a real cost for a key
`Ctrl-K` and `Ctrl-W` already cover between them, so it stays unbuilt until
somebody asks. A word on it is here so the next reader does not re-derive the
`key.delete` collision from scratch.

The prompt enforces its side of this by handling exactly the `Ctrl-` and
`Alt-` keys listed above and returning for the rest — never falling through to
the text path, where Ink would deliver a `Ctrl-` keystroke as its bare letter
and type it. The `Alt-` branch has to sit *below* the `Esc` handling, because
Ink sets `key.meta` for a lone `Esc` too; above it, `Esc` would be eaten by
the word motions and never reach the palette.
`tests/prompt-frame.spec.ts` pins the guard and both orderings directly.

`↑`/`↓` appear four times on purpose: Ink dispatches every keystroke to
*every* `useInput` handler and offers no way to stop one propagating, so the
two keys can only have one meaning at a time and the choice has to be made by
whoever renders both. The Prompt reports through `onArrowClaimChange` whether
it needs them (palette open, or buffer taller than one row); `App` holds that
in state and passes `arrowsScroll` to `useMessageListScroll`. `Ctrl-U` is
arbitrated the same way, on a different signal (`ctrlUScrolls`, driven by
`onFilledChange`). Nothing else is negotiable — `PageUp`/`PageDown`,
`Ctrl-B`/`Ctrl-F` and `Ctrl-D` always scroll the log, so a half-written
multi-row message can never lock the log shut.
`tests/prompt-frame.spec.ts` pins both directions of both negotiations.

The same shape carries one thing that is not a key: `onOverlayRowsChange`
reports how many rows the floating list is taking, so the App can take them out
of the banner's height budget (§1.1). The reason is the same reason the arrows
need arbitrating — two components that cannot see each other both act on one
resource, and only whoever renders both can decide. Here the resource is rows
rather than a keystroke.

### 1.7 Text conventions

- User messages are marked with `>` in the gutter and framed in a `round` blue box, and carry no label inside it. The marker and the frame already say whose line it is, and a user message has no metadata to hang off a header row — so the text sits on the marker's own row rather than under a header.
- Assistant turns keep a header row, `assistant · turn N step N`, because they *do* have metadata; the counter is meta and goes in `gray`. The body starts on the next row.
- Tool calls carry their status as a trailing glyph on the call line: `✓`, `✗`, `…`, `⊘`.
- A tool still `running` when its turn ends never reported a result, so its status is derived from the `turn/end` reason: `completed` → `✓`, `error` → `✗`, anything else (`interrupted`, `aborted`) → `⊘ cancelled`. It must **never** be reported as `✓` unconditionally — that told the user a tool they had killed with Ctrl-C had completed.
- Errors prefixed with `Error:` and rendered in `red`.
- Notes / compactions / plan toggles use the `⤷` prefix and a single-line layout. A note carrying a turn failure or a turn cancellation is *toned* (`red` / `yellow`, full brightness) rather than dim, so the two outcomes the user most needs to notice do not look like a compaction notice.
- **Runtime context** (a `user/message` event whose `source.kind` is not `user`, per dsh-session's contract) renders as `⤷ runtime context · <plugin> (<form>)` with a short dimmed preview (≤ 80 chars) of the injected payload. It takes the note marker, **not** the user's `>` — the latter would falsely attribute the agent's system context to the human at the keyboard. The reducer routes on the typed `source` field, never on text sniffing.

### 1.8 Rendering rules

- **Width-aware.** Layout re-measures on terminal `resize`. No hard-coded widths beyond 80 chars; long output truncates with `…` (see `truncate` in [`src/message-layout.ts`](./../src/message-layout.ts), which caps a call's subject and its result summary separately).
- **No flicker.** Already-emitted messages are static; only the streaming assistant block, the running tool, and the StatusBar re-render.
- **TTY required.** The runner refuses to start without a TTY and prints a one-line error to stderr. Plain pipes are not a use case. The check is the first thing `run()` in `index.ts` does — before the loader await, so it costs nothing and no Session is created. It is ours rather than Ink's on purpose: Ink reports the same condition by throwing from inside `useInput`'s *passive effect*, and `<Static>` (which the banner uses) makes React swallow errors thrown there, turning the failure into a silent hang. See Part 1 banner rule 7.
- **Graceful shutdown.** In raw mode, Ink receives Ctrl-C as a keypress rather than `SIGINT`. While a turn is running it cancels the turn. While idle with an empty buffer the *second* press (§1.6) unmounts Ink first (restoring the terminal), then triggers the same launcher `ctx.appExit` path as `/exit`. The runner never calls `process.exit` outside `commands.ts` and `index.ts`. See [Lessons → Ctrl-C shutdown](./lessons/ctrl-c-shutdown.md) for the investigation playbook behind this ordering.

### 1.9 Markdown rendering

Assistant turns render a curated subset of GitHub-flavored markdown, from the first streamed delta onward. The parser lives in [src/markdown.ts](../src/markdown.ts) (pure, no React, no Ink) and the Ink renderer in [src/components/Markdown.tsx](../src/components/Markdown.tsx). Only the assistant block is markdown-aware; user messages, tool calls, and notes remain plain text.

| Construct | Terminal style |
|---|---|
| `#`–`###` heading | `bold`, color step: `cyan` / `magenta` / `gray` |
| `####`–`######` heading | `bold gray` |
| ` ``` fenced ``` ` | `round` border, language label in `cyan bold`, body syntax-highlighted (`gray dim` until the grammar loads) |
| `` `inline` `` | `cyan dim` |
| `**bold**` | `bold` |
| `*italic*` | `italic` |
| `[label](https://...)` | `underline blue`, label replaced with the URL (no hover on terminal) |
| `-` / `*` unordered list | `▸` bullet, indented one space |
| `1.` ordered list | `1.` `2.` `3.` numeric bullet |
| `> blockquote` | `▏` left bar, `gray dim` content |
| `---` thematic break | `────────────` line |

Raw HTML (`<script>`, etc.) is stripped before the AST is built — see §3.1. Unclosed fences and stray delimiters fall back to a plain `paragraph` so the chat surface never goes blank.

**Spacing and indent normalization.** Paragraphs render with one line of vertical breathing room above and below, so model-written song lyrics and dialog don't look smushed against surrounding blocks. That row is suppressed at the document's own outer edges — a markdown document does not pad its container, because Ink does not collapse margins and the conversation has already decided how much space sits between one entry and the next. The parser pre-strips every leading space and tab at the start of each newline-continued line — the strip runs at the parse boundary (pre-`marked.lexer`) so the model's habit of hand-indenting continuation lines by 10+ spaces does not promote blank-line-separated blocks to a `╭─╮` code frame under CommonMark's 4-space rule. **The pre-strip skips the contents of a fenced code block** (`stripIndentOutsideFences`). Through v0.3 it did not, and every code block in the TUI rendered flush left: in Python that is not a cosmetic loss, because the block the user copies out of the terminal does not run, and it made the v0.4 highlighting actively misleading — coloring structure that the indentation no longer shows is worse than showing neither. A closing fence must match its opener in character and length, and an unclosed fence protects to the end of the input, which is what keeps a streaming block from flattening and then unflattening when its closer lands. Indented (4-space) blocks are deliberately still flattened: a fence is an explicit claim that the contents are code, an indent is a guess, and the guess is wrong for exactly the hand-indented verse this strip exists for. The renderer then applies a uniform **2-space hanging indent** to every soft line break in a text node — a `\n` not followed by another `\n` — so lyrics and dialog continuations read as a hanging indent rather than flush-left (the pre-strip's output) or right-shifted (the model's own 10+-space input). Blank lines (`\n\n`) are preserved end-to-end. Spaces at the very start of the text, and spaces between inline elements (`**bold**` and the next word), are preserved. The indent constant lives in [`src/markdown.ts`](./../src/markdown.ts) as `HANGING_INDENT`; the transform is `applyHangingIndent`.

**Streaming rule.** The block is parsed and drawn as markdown on every `assistant/chunk` event, not held as raw text until `assistant/message`.

Through v0.3 it was held: the assumption was that a half-open fence or an unclosed `*` would churn the layout. The assumption was testable and it is false, and `tests/markdown.spec.ts` now pins the three cases that matter. An unclosed ```` ``` ```` fence lexes to the *identical* AST as the closed one, so the code frame is drawn from the opener and nothing moves when the closer lands. An unterminated `**bo` stays literal text and becomes bold in place, at the same row count. A list grows an item at a time rather than re-forming. What holding the text actually guaranteed was the one reflow the rule was written to prevent — the whole answer re-laid-out at the moment the reader reached it. `tests/streaming-markdown.spec.ts` asserts the frame is unchanged across finalization, header row aside.

Two things do move mid-stream, and both are fine: a blank separator row appears each time a block closes, and a bare `#` draws an empty heading row until its text arrives. They appear at the tail of a `column-reverse` viewport whose newest row is pinned to the bottom edge, which is what the layout is built out of. This is not the timer-driven churn of [docs/lessons/prompt-scroll-snaps.md](./lessons/prompt-scroll-snaps.md): the re-render is caused by a delta arriving, and a delta already re-rendered the block before this change.

**Parse cost.** `Markdown` memoizes the AST on its source, and `MessageList`'s per-entry dispatch is `React.memo`'d on the entry object. Both matter here rather than in general: every mounted entry re-renders on every delta, so without them a finished turn from earlier in the session is re-lexed a few thousand times over the course of the next answer. A single parse is ~0.4ms for a 20KB document; a mounted window of them per delta is not affordable when the frame's job is to keep up with a token stream.

**Syntax highlighting.** Fenced blocks are tokenized by [Shiki](https://shiki.style) through [src/highlight.ts](../src/highlight.ts) (pure, plus the one async loader) and [src/hooks/useCodeHighlight.ts](../src/hooks/useCodeHighlight.ts). The renderer draws **one `<Text>` row per source line** rather than one `<Text>` holding the newlines, because a highlighted line is several differently-colored spans and they need something to nest in. The row count is identical either way, which is the load-bearing property: a block renders plain until its grammar arrives and colored after, and that switch must not move rows under the reader. `tests/highlight-frame.spec.ts` pins it by comparing two live apps — a `text` fence and a `ts` fence — rather than two frames of one app, which would make the assertion depend on Shiki's load timing.

*Plain fallback.* A block with no language, or one Shiki cannot resolve, renders exactly as it did in v0.3 — `gray dim`, no colors, no error. Languages that mean "not code" (`text`, `txt`, `plaintext`, `console`, `output`, `log`) are short-circuited before the loader: they would load successfully and cost a grammar load plus a tokenize pass to produce the rendering we already have. There is deliberately no alias table in this repo; Shiki already resolves the short forms models write, and a second table here would be a copy that goes stale against the one that decides.

*Async load-in.* Shiki is `import`ed on first use, not at boot: the import alone is ~33ms and `createHighlighter` another ~29ms, which is startup budget spent on a session that may never show a code block. The hook holds `undefined` until the grammar resolves — for "no language named", "no such grammar", and "still loading" alike, because the renderer cannot act on the distinction — and the block repaints colored when it lands. Grammars and the highlighter are cached module-wide, so this is once per language per process.

*Incremental cache.* Tokenizing is charged **per line, not per block**. One line is ~0.11ms; a 200-line block is ~14.8ms, and re-tokenizing that block on every delta of the turn writing it is ~30% of a core spent redoing settled work. `createLineCache` keeps each line's tokens and the grammar state that produced it, compares the incoming lines against the ones it holds, and re-tokenizes only from the first difference. This is sound rather than approximate: Shiki's `codeToTokens` returns a resumable `grammarState` and accepts one, and threading it line by line reproduces a whole-block highlight **byte for byte** — verified across a block comment and a multi-line template literal, the two constructs where a line's colors depend on lines above it. `tests/highlight.spec.ts` pins that equality directly, because it is the assumption the cache rests on and the failure mode if it broke would be quietly wrong colors rather than a crash. The reuse test is line equality from the top rather than a prefix hash, so an edit in the middle of a block is correct rather than stale.

*Two themes.* The Shiki theme is `github-dark` or `github-light`, chosen by the appearance the app resolved (§1.10). It is the reason the theme feature exists: a highlighting theme names truecolor hex values, so unlike the named ANSI colors in §1.3 it cannot adapt on its own, and `github-dark`'s comment gray on a white terminal is unreadable. The theme is part of the tokenizer cache's *identity* (`${theme}:${lang}`) rather than a render-time argument, because `createLineCache` caches tokens and tokens carry colors. The grammar state threaded through those caches is unaffected — it is grammar state, not theme state — so switching themes mid-session invalidates the colors without invalidating the resumability the cache rests on. A switch takes the same async path as a first load, and deliberately keeps drawing the old theme's colors until the new tokenizer arrives instead of dropping back to plain first: both readings cost the same number of rows, and only one of them flashes.

**Out of scope (today).** Tables, images, and strikethrough are tracked in v0.4.

### 1.10 Light and dark terminals

The app resolves one **appearance** — `dark` or `light` — at boot, and the whole of what it changes is the two things §1.3 identifies as unable to adapt on their own: the Shiki theme and the lighter brand tint. There is no palette swap. Everything else is a named ANSI color that the terminal already resolves against its own background.

**Resolution order.** An explicit `theme` setting (`dark` or `light`) wins outright. Under `auto` — the default — the terminal is asked, by writing the **OSC 11** query `ESC ] 11 ; ? BEL` and reading its reply; failing that, `COLORFGBG` is consulted; failing that, `dark`. The order is "what the user said, then what the terminal said, then a guess", and the fallbacks are silent: a terminal that ignores OSC 11 is the common case, not an error.

**The measurement, not an average.** A reply is parsed into three normalized channels (`rgb:RRRR/GGGG/BBBB` at any hex width, and the `#RRGGBB` form some terminals send instead), then reduced to WCAG relative luminance — `0.2126 R + 0.7152 G + 0.0722 B` over sRGB-linearized channels — and compared against `0.5`. Averaging the channels instead would be wrong in a way that shows up on real terminals: yellow and mid-gray share a channel average of 2/3, but their luminances are 0.93 and 0.40, so an average calls a yellow-tinted light background dark. `parseOsc11` and `appearanceFor` are pure and directly tested, which is most of this feature's surface.

**The query runs before Ink mounts, and that is not stylistic.** Reading the reply needs a `data` listener on stdin, which switches it to flowing mode and drains chunks out from under Ink's read loop — the same hazard §3.9 documents for scroll input. After mount, stdin belongs to Ink and a late reply would be *typed into the prompt* as garbage. So [src/index.ts](../src/index.ts) fires the query right after the TTY preconditions and awaits it just before `render()`, with the plugin-loader await, the resume plan, and agent creation in between: the terminal's round trip overlaps work that was happening anyway and costs the boot nothing measurable. Raw mode is required (an unset terminal line-buffers the reply until Enter) and is restored afterward, as is the paused state. The `PROBE_TIMEOUT_MS` (100ms) deadline is the whole safety story — a terminal that never answers costs at most that, and only when the setting is `auto`.

**What the app holds is the appearance, not the palette.** `ThemeProvider`'s context value is `'dark' | 'light'`; `usePalette()` derives the palette from it. A context holding the palette object would hand every consumer a new identity on every root render, since `palette()` returns a fresh object. The default is `'dark'`, which is what lets a component rendered outside a provider keep drawing exactly what it drew before this existed.

**`/theme` is the escape hatch**, on the same terms as `/language`: it writes the setting, so the choice survives restart, and under `auto` it reports back what the terminal actually answered — because "auto" alone does not tell the user whether the answer they are about to see is the one they wanted, and the reason to type `/theme` is that it might not be.

Whether the light tint is *comfortable* on a real white terminal, and whether a given emulator answers OSC 11 at all, are real-TTY judgements in the sense of §7 — the automated tests pin the arithmetic, the fallbacks, and that both appearances paint byte-identical rows, but chalk reports color level 0 under vitest so no test here can assert a color escape.

---

## Part 2 · Roadmap

The package is at **v0.1.0-rc.7**. Each milestone below lists what users see when it ships, not what's done internally.

### v0.1 — REPL core (shipped)

- Ink-based renderer mounted as a Cordis bundle on `dsh-base`
- Three-zone layout: StatusBar / MessageList / Prompt
- Session log replay + live subscription
- Slash commands: `/help`, `/clear`, `/status`, `/exit`, `/quit`
- Token counters in StatusBar
- 20 unit tests covering state and commands

Known gaps (deferred, not bugs):
- No tab completion or `@`-mention
- `/compact` is rendered but not user-invoked

### v0.2 — Continuity (shipped)

- **Multiline editor.** The box grows with the buffer to `MAX_PROMPT_ROWS` (10), then scrolls inside itself with a scrollbar. `Ctrl-J` inserts a newline; the `\` + Enter continuation stays for v0.1 backwards-compat.
- **Session resume.** `DSH_TUI_RESUME=last` continues the newest stored session, or an id continues that one. Discovery is `SessionPersistence` — see §3.3.1. The ids themselves only became visible in v0.4, with `/sessions` (§1.5.7), and switching without relaunching arrived with `/resume` in the same version (§1.5.8).
- **`/compact` wired.** Not by this package: it falls through to `ctx.commands`, where dsh-base mounts it.
- **Spinner during turns.** `useRunningClock` drives one interval per status transition; the StatusBar and the Prompt placeholder read the same frame index so the glyph is in lock-step.
- **Error rendering.** Network / model / tool errors get a uniform block in `red`.
- **Markdown rendering.** Assistant turns render a curated subset of GitHub-flavored markdown — see §1.9. v0.2 shipped the "render on finalize" path; v0.4 draws it live from the first delta.

Shipped here but not planned here: the bilingual catalog and `/language` (§3.10), and the `!` shell escape (Part 4).

### v0.3 — Discoverability (partly shipped)

Shipped:

- **Slash-command tab completion.** The `/` palette filters as you type and `Tab` completes the highlighted name, landing the cursor after a trailing space.
- **Tool approval flow.** `y`/`n`/`Esc` on a card beside the Prompt, not a modal, listing the arguments of the call being authorised. It was never blocked on the dependency this spec claimed — see §3.2.1.
- **`/model <name>`.** Switches the live agent and the saved default together.
- **`/context`.** Window, cumulative spend, and a live occupancy percentage read off the newest turn — see §3.3.2.
- **History.** `↑` / `↓` (and `Ctrl-P` / `Ctrl-N`) walk the user's prior inputs in this session.
- **Steering.** The prompt stays live while a turn runs and `Enter` routes to `agent.steer` — see §1.6.
- **Output previews.** Tool results and `!` shell output are capped at 8 lines with a translated `… +N lines` marker, replacing both the one-line summary and the uncapped shell paint — see §1.2.
- **`@`-mention file picker.** An `@` that opens a word lists matching files under the working directory; `Tab`/`Enter` inserts the path. Completion only — no file contents are attached. See §1.5.2.
- **`/plugins`.** Loader introspection — package name, lifecycle phase, broken entries first — plus `enable`/`disable`, which rewrite the loader config and refuse the three cases that would be unrecoverable. See §1.5.3.
- **`/usage`.** Per-turn token counts, grouped by turn rather than by step, with a fold row instead of a truncated table. See §1.5.4.

Still open: nothing — v0.3 is complete.

### v0.4 — Polish

- **Syntax highlighting.** *Shipped.* Assistant code blocks are tokenized by Shiki, loaded on first use and cached per line so a streaming block is not re-tokenized from the top on every delta — see §1.9. Two themes, chosen by the auto-theme item below.
- **Auto theme.** *Shipped.* The terminal is asked its background color over OSC 11 at boot and the app picks a light or dark appearance from the reply's luminance; `/theme auto|dark|light` overrides it and persists. What changes is narrow on purpose — the code-block theme and the lighter brand tint, the only two colors that name an absolute value. See §1.10.
- **Streaming markdown.** *Shipped.* The assistant text is re-parsed on every `assistant/chunk` event and drawn as partial markdown, instead of waiting for `assistant/message` — see §1.9 for why the partial-parse churn the original plan feared does not happen.
- **Truncation.** *Shipped, as a global switch.* The 8-line cap itself shipped in v0.3; `/verbose` and `Ctrl-O` now raise it to 200 lines for the whole transcript at once (§1.2, §1.5.6). The per-entry `▾ show more` this item originally named is **not** what shipped and stays refused — expanding *one* entry needs a focus/selection model this app does not have (roadmap §6). A global switch needs none, which is why it could ship without reversing that decision.
- **Clipboard.** *Shipped as `/copy`.* The newest reply, or the newest fenced block, goes to the system clipboard over OSC 52 — across SSH included. `/paste` is **not** coming: reading the clipboard needs a stdin listener mid-session, which is Ink's, and every terminal already pastes on its own. See §1.5.5.
- **Session listing.** *Shipped as `/sessions`.* Not on the original v0.4 list, and added because v0.3's resume turned out to be unreachable: it wants ids that were printed nowhere. The listing shows them abbreviated and `planResume` accepts a prefix. See §1.5.7.
- **In-session resume.** *Shipped as `/resume`.* Also unplanned, and the direct consequence of the item above: once the ids were on screen, relaunching to use one was the only remaining obstacle. §3.3.1 had sized this as an agent-swap project; most of it was already built, and the missing piece was a re-seed of the projection. See §1.5.8.

### v1.0 — Production

- **Vim / Emacs keybind toggle.** `/keybinds vim` switches the prompt editor.
- **Plan mode.** *The TUI's half is shipped.* `plan/mode` projects to a `plan` entry and draws `⤷ plan mode on`/`off` in both languages (§1.4). The `/plan` command and the read-only run are `@deepseek-ai/dsh-plan-mode`'s, not this package's — it reaches the REPL through the `ctx.commands` fallback (§1.5), the same way `/compact` does. Nothing is left here but the diff preview, which needs a diff to exist first.
- **Sub-agent visualization.** Sub-agent outputs render as nested MessageList rows with a `↳` indent. **Blocked on a version line, not on the work.** `subagent/descriptor` and `tool-workflow/agent-start|agent-end|run-start|run-end` are in the session vocabulary, and `@deepseek-ai/dsh-subagent` / `@deepseek-ai/dsh-tool-workflow` do exist — but only on `0.1.2-rc.x`, whose peer range is `@deepseek-ai/dsh-session@^0.1.2-rc.1`. This package pins its whole peer set to `0.1.0-rc.7`. Adding either one purely to read its type declarations would pull a second `dsh-session` into the tree, and the module augmentation that gives session events their payload types would then have two disagreeing targets. The unblock is a tree-wide bump to `0.1.2-rc.x`, not a devDependency.
- **MCP tool surface.** Surface MCP-provided tools with the same approval flow as built-in tools. Blocked harder: no MCP plugin is published at all, on any version line, so there is nothing to program against.
- **Hooks visualization.** Render `PreToolUse` / `PostToolUse` hook outputs inline. Blocked the same way as MCP: `hook/invoked` and `hook/result` are named in `KNOWN_SESSION_EVENT_TYPES` and nowhere else — no `dsh-hooks` package exists to define their payloads.

### Aspirational (no commitment)

- Mouse support beyond the wheel (click to focus, drag to select rows)
- Image paste (iTerm / Kitty / Sixel)
- Multi-session tabs
- Remote session attach (SSH in, see the same TUI)

---

## Part 3 · Conventions

Rules contributors must follow. Breaking any of them needs a PR that updates this file in the same diff.

### 3.1 File layering

```
src/
├── index.ts            # Cordis plugin entry — side effects
├── renderer.tsx        # Ink root — wires state + components
├── state.ts            # Pure reducer — (UiState, SessionEvent) → UiState
├── types.ts            # Type-only — UiEntry, UiState, isRenderable
├── commands.ts         # Pure dispatch — string → CommandResult
├── invariant.ts        # Type companion for dsh-invariants (no runtime)
├── markdown.ts         # Pure markdown → UI AST (no React, no Ink)
├── highlight.ts        # Pure token shaping + line cache, and the one Shiki load
├── resize.ts           # Real-TTY resize owner — debounce, clear, rerender, repaint
├── services.ts         # Typed optional-service reads off the Cordis context
├── environment.ts      # Process facts — version, cwd, git label
├── interrupt.ts        # Ctrl-C / abort plumbing
├── width.ts            # Display-column measurement (CJK-aware)
├── scroll.ts           # Pure scroll arithmetic
├── message-layout.ts   # Pure message-list layout arithmetic
├── prompt-editing.ts   # Pure prompt buffer edits — beside Prompt.tsx
├── prompt-layout.ts    # Pure prompt layout arithmetic
├── file-mentions.ts    # `@` mention parsing + path ranking, and the one walk
├── plugins.ts          # Pure classification + table for `/plugins`
├── banner-art.ts       # Pure banner art + text — beside Banner.tsx
├── theme.ts            # Pure appearance arithmetic, and the one terminal probe
├── clipboard.ts        # Pure OSC 52 sequence + what `/copy` selects
├── hooks/              # React-only — useInput, useEffect, useState
└── components/         # React components — pure functions of state
```

The bottom third of that list is one pattern repeated: **a component whose logic outgrew it gets a pure module beside it, not a bigger component.** `prompt-editing.ts`/`prompt-layout.ts` came out of `Prompt.tsx`, `message-layout.ts` out of `MessageList.tsx`, `banner-art.ts` out of `Banner.tsx`. Each is importable and testable without mounting anything, which is why the pure half is unit-tested directly and only the layout goes through the frame (§3.4).

**Import rules:**

- `state.ts` may import from `types.ts` only.
- `commands.ts` may import from `types.ts`, `services.ts`, and any type-only package export.
- `markdown.ts` may import from external parsers (`marked`) and `types.ts`. It must not import React, Ink, or any component.
- The pure layout/art/editing modules (`width.ts`, `scroll.ts`, `message-layout.ts`, `prompt-editing.ts`, `prompt-layout.ts`, `banner-art.ts`) may import each other, `types.ts`, and `environment.ts`. They must not import React, Ink, or any component — that is the whole point of extracting them.
- `file-mentions.ts` is pure except for `listFiles`, which reads the filesystem. It lives beside the pure modules because everything a test needs to pin — what counts as a mention, how paths rank, what the buffer looks like afterwards — is pure; the one I/O function is kept in the same file so the reader can see the whole feature rather than chase a second module for one `readdir`.
- `highlight.ts` follows `file-mentions.ts`: pure except for `loadTokenizer`, which dynamically imports Shiki and loads a grammar. Everything a test needs to pin — how a Shiki token becomes an Ink one, which languages are treated as plain, and exactly which lines the cache re-tokenizes — is pure, and the one async function is kept in the same file so the reader sees the whole feature. It may import from `shiki` (dynamically, inside `loadTokenizer`) and must not import React, Ink, or any component.
- `theme.ts` follows the same shape: pure except for `probeAppearance`, which writes to a stdout and listens on a stdin. It **imports nothing at all**, and that is deliberate rather than incidental — the brand tint *pair* lives here rather than in `banner-art.ts` because a `theme.ts` that reached back for it would close a cycle (`i18n.ts → theme.ts → banner-art.ts → i18n.ts`, since `banner-art.ts` reads the string catalog and `i18n.ts` needs `THEME_PREFS`). The rule that decides which module owns a color: `banner-art.ts` keeps the values that have *one* value, `theme.ts` owns the ones that are a pair, because owning a pair means choosing between them.
- `clipboard.ts` is pure outright — no I/O at all, because copying is one-way and there is no reply to read. It may import `markdown.ts` (so `/copy code` agrees with what was drawn), `types.ts`, and `clampOutput` from `shell.ts`. That last one is a cross-feature import on purpose: it is a byte-safe truncation with the split-code-point case already solved, and a second copy would duplicate that fix. It must not import React, Ink, or any component.
- `hooks/` may import from `state.ts` (as a function call), `markdown.ts` (as a function call), the pure modules, `types.ts`, and React.
- `components/` may import from `hooks/`, `markdown.ts` (for the `Markdown` component and AST types), the pure modules, `types.ts`, and React. They do **not** import `state.ts` directly — they receive derived props from the renderer.
- `renderer.tsx` is the only file that wires the reducer to the hooks.
- `index.ts` is the only file that imports Cordis, runs side effects, calls `randomUUID`, and calls `render()`.

Violating these rules breaks testability. The renderer is the integration point; everything below it is a pure function of inputs.

### 3.2 Reducer purity

`state.ts` is a **pure function** `(UiState, SessionEvent) → UiState`. Constraints:

- No `Date.now()` — inject a `now()` parameter for tests if a timestamp is needed
- No `Math.random()` — generate IDs upstream and pass them in
- No `import 'fs'`, `import 'os'`, or network access
- No `console.log` — emit through the session event stream, not the reducer
- No mutation — always return a new `UiState`

The reducer is the unit-test surface for the model layer. Every new `SessionEvent` type needs a `state.spec.ts` case. See the existing test for the exhaustive `kind` switch in `MessageList.tsx` — the same exhaustiveness discipline applies to the reducer.

#### 3.2.1 What the reducer cannot project yet

**Approval prompts are answered, but not by the reducer.** `dsh-session` rc.7 lists `approval/asked`, `approval/decided` and `approval/policy` in its generated persistence catalog — the set of event types this build will read back from a log — but they are **not** members of the typed `SessionEventMap`. The plugin that merges those variants in is not a peer dependency of this package, so `SessionEvent` here is a union that says those events cannot occur. A `case 'approval/asked'` in the reducer would not compile without a cast, and the cast would be asserting the shape of a payload no installed type declares. That much is still true, and it is why there is no approval `UiEntry`.

This section used to conclude from that the approval flow was blocked. **The conclusion was wrong, and the way it was wrong is worth keeping.** The question a user has to answer never travels through the session log in the first place: `dsh-tools` calls `ctx.approval.request()`, and `ApprovalService` dispatches `approval/request` as a **waterfall** on the Cordis context. Reading the log is how you learn an approval *happened*; answering one is a live request/response with no reducer in it. Looking for the feature in the event union found the one place it provably was not.

So `hooks/useApprovalRequests.ts` registers this terminal as the answerer for its own agent and holds the listener's promise open until a keystroke settles it, and `components/ApprovalPrompt.tsx` draws the oldest pending question with `y`/`n`/`Esc`. It sits beside the Prompt rather than inside the log, so nothing about it is `UiState`. Three facts make that safe, and each is load-bearing:

- **The default is a silent denial, not a missing feature.** `ApprovalService` fails closed: with no registered answerer it returns `'unavailable'`, which `dsh-tools` maps to a denial. dsh-base's `read-only` and `workspace-write` presets both set `approval: ask`, so a TUI without this hook denied every tool call that needed a human, and showed no question while doing it.
- **The listener claims only its own agent's questions**, declining the rest with `next()`, so a bundle running several agents never has one terminal answering for another's.
- **Every path settles the promise.** The user answering, `req.signal` aborting (the asker withdrew), and the hook unmounting all resolve it — the last as `'unavailable'`, which is exactly what the service would have produced without the hook. A promise held forever would wedge the turn.

There is no "always allow": `'allowed-once'` is the only grant the vocabulary defines, so there is no third key to bind.

**The card shows the call's arguments, and the request does not carry them.** `ApprovalRequest` is a tool name, an optional reason, an optional `callId` and an abort signal — nothing that says what the call would *do*. A card built from the request alone asks "allow `Bash`?", which is not a question anyone can answer: every destructive command and every harmless one produce the same prompt, so the only rational answers are always-yes and always-no, and a permission gate that trains either is worse than no gate.

The arguments are found rather than received. `callId` is documented as the hook for exactly this — it "lets a UI attach the prompt to the tool call it already streamed" — and the App has already projected that call into `state.entries` with its `args` string attached, because the transcript needed it first. So the renderer passes an `argsFor(callId)` resolver down and the card resolves its own question, scanning `entries` from the newest end; the App does not decide *which* question is on screen (the oldest), so it must not be the one doing the lookup. A missing `callId` and a call absent from the log are not distinguished — both mean there is nothing to show, and the question stays answerable either way.

What the card lists is deliberately not what the transcript lists. `toolCallSummary` picks one identifying argument (`Bash(pnpm test)`), which is right for a row being skimmed and wrong for a row being authorised: whichever argument the summary dropped is exactly the one that could make the call something other than what it looks like. `approvalArgs` therefore lists every top-level key and shortens only the values, at 160 columns rather than the transcript's 60, capped at six rows with the rest counted. Nested values are re-serialised rather than printed as `[object Object]`, since the shape is part of what is being authorised, and a malformed payload degrades to one raw row for the same reason the summary does.

What *is* typed and is projected by the reducer: `TurnEndReasonMap.blocked`, which `dsh-agent` documents as a pre-step rejection — the turn was refused before it reached the model and the messages it had claimed were discarded with it. That is the one approval-shaped fact reachable today, and it renders as a note saying the turn never ran rather than as the raw word `blocked`.

**A `turn/end` reason this build does not name still prints.** `TurnEndReasonMap` is merge-extensible, so the reducer's reason switch keeps a `default` arm that prints the bare `kind`. That arm is not dead code and is not a `TODO`: it is what a forward-compatible union looks like on the read side, and `state.spec.ts` covers it with a deliberately fabricated variant.

### 3.3 Slash command contract

`commands.ts` is a **pure dispatcher**: `(raw: string, ctx: CommandContext) → CommandResult`. The Prompt calls it; the renderer handles the result.

- Slash commands are case-sensitive: `/exit`, not `/Exit`.
- A line is a slash command iff it starts with `/` and matches a known name.
- Unknown `/foo` returns `{ kind: 'unknown' }`. The renderer turns it into a failed `command` entry in the log; it is **not** forwarded to the model, which would spend a turn having the model guess at a typo.
- A `handled` result with no `message` prints nothing. Output that exists is appended as a `command` entry — never written to `stdout`/`stderr`, see §1.5.
- Reserved prefixes (`/`, `!`) cannot be redefined.
- A slash command typed while a turn is running never reaches the dispatcher: the renderer refuses it with a note and the line is not steered either (§1.6). `!` escapes are unaffected.
- Adding a slash command requires:
  1. A case in `commands.ts`
  2. A test in `tests/commands.spec.ts` (every command, every invalid input shape)
  3. An entry in `README.md` and `README.zh.md` slash-command table
  4. A frame assertion in `tests/command-output.spec.ts` if it prints anything — that its text reaches the screen, which unit tests over `dispatch` cannot see

#### 3.3.1 How the dispatcher grew an argument, a model, and a resume

This section used to record why `/model` and `/resume` could not be built. Both
are built. The blockers were real and each was removed deliberately, so the
resolutions are kept here — the shape of the fix is the part worth reusing.

**`dispatch` is now async and reads arguments.** The signature is
`(raw: string, cmd: CommandContext) => Promise<CommandResult>`, and the line is
split on whitespace rather than reduced to its first token. Synchronous commands
still resolve immediately. The caller in `renderer.tsx` drives the promise with
`void dispatch(...).then(...)` and appends the entry when it settles, so the
prompt stays live while a provider call is in flight — Ink ignores a handler's
return value, which is why the promise cannot simply be awaited at the call site.

**`/model <provider>/<name>` switches the live agent and the default.** The two
are different facts and both have to be written, in this order:

- `modelRef.current = { provider, model }` mutates the `ModelSelectionRef` handed
  to `installModelSelection(agentCtx, ref)` in `index.ts`. That ref is what
  actually routes the next request. It reaches the App as a prop, which is the
  whole fix: the ref used to live only in `run()`'s closure.
- `agentDefaultModel.saveSelection()` persists the choice through dsh-base's
  `settings` provider, which is what the *next* launch starts with.

Writing only the second was the trap named here before: the status bar would
have agreed with the setting and disagreed with the running session. A bare
`/model` prints the current selection instead of switching.

**The status bar follows, because the selection is state.** `renderer.tsx` holds
it in `useState` and `/model` calls `refreshSelection()` after the switch. The
old `useMemo(…, [ctx])` read once per mount and would have left the header naming
the model the session opened with.

**`/resume` is discovery, and discovery is `SessionPersistence`.** `resume.ts`
lists stored session headers through that service and picks a target;
`AgentRegistry.resume({ resumeSessionId })` does the rest, including durably
closing an interrupted final turn. `DSH_TUI_RESUME=last` continues the newest
stored session and any other value is taken as an id. The three failure paths —
no persistence plugin mounted, an empty store, an id that is not there — are all
user-visible choices rather than errors: each starts a fresh session and states
why, as a note in the transcript. That notice cannot be a write to stderr,
because the alternate screen erases anything printed before Ink's first frame.

**What was missing was not resume but discovery of the ids to resume.** A
`tui-<uuid>` id is 40 characters that appear nowhere the user can read them, so
`DSH_TUI_RESUME` was a documented feature nobody could aim. `/sessions`
(§1.5.7) prints the store, and the two ends had to be designed together: the
listing abbreviates ids to twelve characters, and `planResume` accepts a unique
prefix, checking an exact match first so a full id can never be read as a prefix
of a longer one. An ambiguous prefix is refused with its match count rather than
resolved by picking one — resuming the wrong history is a failure the user only
discovers after reading a transcript that is not theirs.

Even abbreviated, a worst-case row is about 95 columns. Widening the terminal's
share further would mean dropping the timestamp or the cwd, which are the
columns that tell two sessions apart, so the row is allowed to overflow and the
*order* of loss is what is guaranteed instead: the `(this one)` marker sits
before the summary, so an 80-column cut takes the summary's tail and leaves
"you are here" standing.

**The agent-swap path this section sized turned out to be mostly built.** The
prediction was that mid-session switching needed real work because `index.ts`
creates the agent before `inkRender` and passes it as a prop. What that missed
is that the App was already written to tolerate a changing agent: the
`session/event` subscription filters on `agent.session.id` and re-subscribes
when it changes, and `useShell`, `useApprovalRequests` and `useRegistryCommands`
all key their effects on the agent itself. Exactly one thing did not follow —
the reducer's lazy initialiser, which runs once at mount, so the projection
stayed on the old session's entries.

So `/resume` (§1.5.8) is a re-seed plus a mutable handle. `useSessionEvents`
compares the session id **during render** and dispatches a `seed` action when it
changes; doing it in an effect would draw one frame of the previous transcript
before replacing it, which in a terminal is a visible flash. `index.ts` keeps
the whole `AgentHandle` rather than destructuring `agent` out of it, swaps it,
calls `rerender`, and only then awaits `dispose()` on the previous one — that
order means no frame is ever rendered against a disposed agent. Holding the
handle also fixes a leak that boot-only resume hid: `dispose()` is what unwinds
an agent's scope, and it was being dropped on the floor.

Three cases are refused rather than performed. A target equal to the live
session returns "already here", because `agents.resume()` would reject a second
agent on a registered id and the user would read a registry error where the
honest answer is that nothing needs to happen. A load or setup failure is caught
at the swap, since only there is it known that nothing was swapped — the message
can say the session is intact instead of reading like a lost transcript. And a
request that `planResume` resolves to nothing does **not** start a fresh session
the way a boot does: mid-session that would trade the user's actual work for a
typo.

`agent.status === 'running'` is also refused, and this is now the *second* of
two guards rather than depth behind an impossibility. It used to be depth: the
prompt was inert for the whole turn, so a user could not type `/resume` at that
moment at all. Steering (§1.6) removed that inertness — the box takes input
during a turn — and the App therefore refuses every slash command while
`state.status === 'running'` before `dispatch` is reached. This check remains
because it guards the function rather than the keystroke: `dispatch` is
reachable from a test and from any future caller that is not the prompt. A
running `!` command still needs no check of its own, since a running shell does
close the box.

#### 3.3.2 `/cost` cannot be built, and `/context` can

`/cost` is named in §1.5 as future work. It should be un-named: **there is no
price data anywhere in the peer tree.** `TokenUsage` counts tokens,
`LlmModelInfo` and `LlmResolvedModelInfo` carry identity, context capacity,
output caps and reasoning metadata — and nothing carries a rate. A currency
figure would therefore have to come from a price table hardcoded in this
package, which would be stale on the day it shipped, wrong per provider, and
wrong again across the three separately-priced input tiers (uncached, cache
read, cache write). Showing a confidently wrong number about the user's money is
worse than showing nothing. If pricing ever becomes a provider-owned fact the
adapter reports, revisit; until then the token counts in the status bar *are*
the cost surface.

A **context-window percentage** is a different matter, and `/context` is built.
It reports the model, the advertised window, cumulative billed input, cumulative
output, and a live occupancy with its percentage. Two notes, both resolutions —
and the second one is the more useful of the two, because the warning that
caught it was written in this section *before* the command existed and then not
heeded when it was built.

- **The denominator did not need a promise after all.** This section predicted
  `ctx.llm.resolveModelInfo(provider, model, signal)` and therefore a
  `useEffect`. What ships reads `agent.session.requestContext()?.contextWindow`
  — the capacity the last request actually carried, folded into the session and
  available synchronously. It is still optional, so an adapter that never
  advertised one leaves the field `unknown` rather than zero, and the percentage
  is omitted entirely rather than shown as `0%`.
- **The numerator was wrong for one release, and the reason is worth keeping.**
  The first `/context` summed billed input across *every* assistant entry and
  divided that by the window. That is cumulative spend, not occupancy: each
  request resends the conversation, so the sum counts the same prefix once per
  turn. The percentage climbed past 100% on a long session while the context was
  half empty, and — the part that made it useless rather than merely wrong — it
  could never fall after a `/compact`, which is the one moment a user consults
  it. The two quantities are identical for exactly one turn, which is how a
  test suite can pass over the mistake.

  The fix is `contextOccupancy` in [`src/usage.ts`](./../src/usage.ts): read the
  **latest** assistant entry's billed input plus its output, and nothing else.
  That module now owns both readings side by side, with the distinction stated
  at the top, because the bug's habitat was two copies of the same loop — one in
  `StatusBar.tsx`, one inlined into `commands.ts` to avoid importing a React
  module. `/context` labels them apart on screen too (`billed input (session):`
  versus `in context now:`); a percentage with an ambiguous numerator is a
  number a user cannot check.

  It is deliberately approximate: it cannot see anything appended since the last
  reply, and it trusts the provider's count rather than re-tokenizing. Both
  errors under-report, which is the safe direction for a gauge whose job is to
  warn. Before any turn has reported usage the line is omitted entirely — absent
  is not the same as zero.

### 3.4 Testing

| Surface | Required coverage |
|---|---|
| `state.ts` | 100% (every event type, every branch) |
| `commands.ts` | 100% (every command, every invalid input shape) |
| `markdown.ts` | Every block-level construct (heading, paragraph, code, list, blockquote, hr) + at least one inline construct + the failure-mode fallback (unclosed fence, stray delimiter) + every prefix of a whole answer, since streaming renders all of them (§1.9) |
| `highlight.ts` | Token shaping including `fontStyle: -1` (a naive bit test on -1 sets every flag at once) + which languages count as plain + the cache's re-tokenize count on prepend/edit/append, against a fake tokenizer + the real-Shiki equality: line-by-line with threaded state must equal a whole-block highlight byte for byte |
| `clipboard.ts` | The exact sequence against literal base64 (not against another `Buffer` call) + UTF-8 including a surrogate pair + the tmux wrap's escape doubling and its undoubled terminator + `TMUX` detection, and that `TERM` is not consulted + what `pickCopyText` reaches past + the clamp's byte boundary. Plus a frame test: the bytes must actually reach the stream, which no unit test over the builder can see |
| `theme.ts` | The OSC 11 reply parser across the shapes terminals actually send (`rgb:` at every hex width, `#RRGGBB`, BEL- and ST-terminated, garbage) + the luminance threshold, including a case an averaging implementation gets wrong + `COLORFGBG` fallback + `probeAppearance` against a fake stdin: the reply path, the silent-terminal deadline, raw mode restored either way |
| `hooks/*` | Whatever the hook actually owns. A hook that only wires a pure module to React is covered by that module's spec plus a frame test; a hook that owns state or a timer gets a mounted probe (`tests/running-clock.spec.ts`, `tests/session-events.spec.ts` are the two patterns) |
| `components/*` | Frame-level, through the fake TTY. See below — there are no snapshots and no `renderHook` in this package |
| `resize.ts` | A settled drag always ends with a frame on screen — including the drags that produce a byte-identical frame (height-only, and back to the starting width) |
| Command output | Frame-level, in `tests/command-output.spec.ts`: every command that prints reaches the screen, an unknown command is reported in the log, and nothing is ever written to `stderr`. `dispatch` returning the right string is not evidence the user saw it |
| `index.ts` | Smoke test: instantiate the plugin with a mock Agent and assert `render` was called |

Use `vitest`. Tests live in `tests/` mirroring `src/`. Run with `pnpm test`. Test files do **not** import from `lib/`; they import from `src/`.

**Where a test goes.** The package tests along a seam, not per file, and the seam is *pure module vs. React*:

- **Pure modules get direct unit specs.** `state.ts`, `markdown.ts`, `scroll.ts`, `resize.ts`, `message-layout.ts`, `prompt-layout.ts`, `prompt-editing.ts`, `width.ts` are all reachable without booting anything, so they are tested by calling them.
- **Components are tested through the frame**, by rendering the real tree onto a fake TTY and asserting on the characters that reach the screen. `Markdown.tsx`, `MessageList.tsx`, `Prompt.tsx` and `SlashPalette.tsx` therefore have no file named after them in `tests/` — they are covered by `prompt-frame.spec.ts`, `message-scroll.spec.ts`, `command-output.spec.ts` and friends. This is deliberate: a component spec asserting on a React tree would pin the implementation, while the frame test pins the thing the user actually looks at. **An empty row in a file-to-spec table is not automatically a gap here** — check the frame specs before filing one.
- **Hooks split by what they own.** A hook that only adapts a pure module to React needs no spec of its own. A hook that owns state or a timer gets a mounted probe, because its contract is a sequence over time and no single frame can show it.

Do not add a snapshot test. There is no snapshot in this package and no `renderHook`: Ink ships its own reconciler, so `react-dom/test-utils` is not installed and `act` comes from the `react` root export.

**What the suite structurally cannot reach, and what discharges it.** Every test runs with no TTY and with chalk's color level pinned to 0. Three shipped behaviours are therefore covered only as arithmetic: the OSC 11 probe never gets a reply, the OSC 52 write never reaches a clipboard, and no assertion can say whether a chosen color is legible. `docs/TUI-ROADMAP.md` §7 makes "it works in a real TTY" an acceptance rule, so those three are discharged by `scripts/tty-check.ts` (`pnpm tty-check`) — a diagnostic a human runs in their own terminal.

Two rules govern it. It **imports the real modules** (`src/theme.ts`, `src/clipboard.ts`, `src/highlight.ts`, `src/banner-art.ts`) rather than reimplementing the sequences: a checker carrying its own copy of the OSC 11 parser would verify the terminal and prove nothing about the code that ships. And it prints the two human-answerable checks **as questions**, never as ticks — a program cannot see whether a comment token is readable, and a script that claims it can is worse than no script. This is not a test, it does not run in CI, and `package.json#files` excludes `scripts/` so it does not ship.

### 3.5 Secret handling

- API keys **never** appear in chat, code, commit messages, or issues.
- The runtime credentials file is `~/.dsh/.env` (mode `0600`). `dsh-app-boot/loadLayeredEnv` reads it on every launch.
- Project-local `.env` and `.env.*` are git-ignored. `.env.example` is allowed and is the place to put a placeholder.
- Rotating the key: edit the env file. No shell restart required; the next `dsh` launch reads the new value.
- When pasting config that contains a key, redact it as `sk-…` or `sk-replace-me`. Never paste a real key.

### 3.6 Platform handling

- **TTY required.** Ink needs a real TTY. `run()` tests `process.stdin.isTTY` (raw mode reads keys through it) *and* `process.stdout.isTTY` (the renderer needs a column count), prints a one-line error to stderr naming which stream failed, and exits 1.
- **Windows.** PowerShell 7 + Windows Terminal. The README documents the long-path registry key (`LongPathsEnabled = 1`).
- **macOS / Linux.** Any ANSI-capable terminal. iTerm, Terminal.app, GNOME Terminal, Kitty, Alacritty, WezTerm all work.
- **No `cmd.exe` / `conhost`.** They don't render Ink correctly. Document this in the README.
- **Color.** Respect the `NO_COLOR` env var. Default to TTY detection otherwise.

### 3.7 Versioning

- Lockstep with `dsh-*` peer packages: `dsh-agent`, `dsh-agent-default-model`, `dsh-invariants`, `dsh-llm`, `dsh-session`.
- Bump all of them together. A pre-release line `0.1.0-rc.N` advances in lockstep across the family.
- Don't bump `dsh-base` separately from the others — it's a dev-dep here, but the `latest` dist-tag on npm is currently broken. Always use `@next` until `latest` is repaired.

### 3.8 Publish flow

```sh
# 1. Update version in package.json (and the lockstep dsh-* peers)
# 2. Update version pin in README.md and README.zh.md
# 3. Verify
pnpm test && pnpm run typecheck && pnpm run build
# 4. Publish
npm publish --access public
```

After publish, the dsh-tui bundle becomes available as `@deepseek-ai/dsh-tui@0.1.0-rc.N+1`. The launcher reads `package.json#dsh.bundle.patch` to wire the bundle into profiles.

### 3.9 Git workflow

- `main` is the only long-lived branch. Releases are tagged `v0.1.0-rc.N`.
- Feature branches: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- Commit messages: `type(scope): subject` (Conventional Commits). One subject, one change.
- PRs require green CI (typecheck + test + build).
- Don't commit generated files (`lib/`, `.tsbuildinfo`, `coverage/`). The `.gitignore` should already exclude them; if it doesn't, add it in the same PR.

### 3.10 i18n

The interface is bilingual; everything a contributor reads is English.

- **On-screen strings: English and Chinese, from one catalog.** Every string this UI can put on screen lives in `src/i18n.ts`, once per language. English is the source of truth — `EN` is typed as `Catalog`, so a key added without an English string fails to compile, and `tests/i18n.spec.ts` fails when the Chinese side is missing one. Components read strings through `useStrings()`, never as literals.
- **`/language` switches the chrome, not the conversation.** The command changes the language of the TUI's own text and nothing else. It does not instruct the model, does not touch the prompt, and does not appear in the session log as anything but a command entry. The choice persists in `~/.dsh/tui.json`.
- **Four things stay untranslated, deliberately.** Brand art (the whale, the wordmark, the slogan) is a logo. Key names (`Tab`, `Esc`, `Enter`) are what is printed on the keyboard. Plugin command descriptions come from another package's registry and are shown as written. Identifiers a plugin chose — producer names, form names, model and provider ids — are names, not prose.
- **`(+N more)` used to stay untranslated, and no longer does.** `src/message-layout.ts` is measured by `src/scroll.ts` and rendered by `MessageList`, and the two must agree on the row count to the character — so a language-dependent summary string would have meant threading the catalog into the scroll geometry. The fix was to stop returning a string. `outputPreview` returns `{ lines, hidden }`, the renderer draws `hidden` through `entries.hiddenLines(n)`, and every row it draws is `wrap="truncate"` — so the *height* stays language-independent even though the *text* is not. Reach for that shape whenever measurement and translation seem to be in conflict; `shellStatusKinds` is the same move.
- **Column width, not character count.** A CJK glyph occupies two terminal columns. Any string that is padded, centred, or truncated must be measured with `displayWidth` from `src/width.ts`. Counting characters lets a row through at twice its budget, the terminal wraps it, and Ink — which erases by logical line count — under-erases it on every redraw. See `docs/lessons/resize-reflow.md`.
- **README: bilingual.** English in `README.md`, Chinese in `README.zh.md`. Update both in the same PR.
- **Spec, comments, commit messages, PR descriptions: English.** Even when the surrounding repo uses Chinese for communication.

### 3.11 Dependencies

- Prefer the existing `dsh-*` peer tree. Don't reach for a new npm package when a peer already covers the need.
- Native modules need `pnpm approve-builds`. The current approval list: `node-pty`, `koffi`, `protobufjs`, `@deepseek-ai/dsh-subprocess-local`. Adding a new native module requires documenting it in the README.
- React/Ink ecosystem is open (`ink`, `ink-text-input`, etc.) but new UI deps should be justified in the PR description.
- `shiki` is a runtime dependency, imported dynamically rather than at boot (§1.9). It is a large package for what it does, and it is here because the alternative for TextMate-grammar-accurate highlighting is shipping and maintaining our own grammars. It is pure JavaScript — no native module, no `node-pty` — so it adds nothing to the approval list above, and a session that never renders a code block never pays for it.

### 3.12 Docs track code (in the same PR)

Code and docs ship in lockstep. A change to `src/` without a matching doc update is a bug, not a draft.

| Code change | Doc update |
|---|---|
| New `SessionEvent` type | `state.ts` case in `tests/state.spec.ts` + reducer contract section if it introduces a new rule |
| New slash command | `commands.ts` + `tests/commands.spec.ts` + slash-command table in `README.md` and `README.zh.md` |
| New `UiEntry` kind | `scroll.ts` `estimateEntryRows` + `MessageList.tsx` case + a row-count case in `tests/scroll.spec.ts` + Part 1 if it has a glyph or color |
| New on-screen string | `Catalog` in `src/i18n.ts` + **both** the `EN` and `ZH` entries (English alone does not compile; a missing translation fails `tests/i18n.spec.ts`) |
| New platform behavior (env, build step, native dep) | `README.md` "Use it" / "Develop it" + Windows callout if relevant |
| New color, glyph, border, layout rule | `docs/SPEC.md` Part 1 — Style |
| New milestone or completed feature | `docs/SPEC.md` Part 2 — Roadmap (move from planned to shipped) |
| New convention or rule | `docs/SPEC.md` Part 3 — Conventions |
| New contributor-facing note | This file (`AGENT.md`) |

The same rule ships with `AGENTS.md` rule 8, in summary form, for agents that only read `AGENTS.md`. Both are binding.

**Why `AGENTS.md` (not `AGENT.md` or `CLAUDE.md`).** Aider, Cursor, Continue, and several other tools look for the filename `AGENTS.md` (uppercase, plural) when an agent joins a repo. Using that exact name — instead of a tool-specific name like `CLAUDE.md` — means the same file is picked up by any agent, not just the one that created it. The `S` matters: tools match the filename literally.

---

## How to evolve this document

This file is the source of truth for the project's design contract.

**To change a rule:**
1. Open a PR that updates both the code and the relevant section of this file.
2. Get one approval from a project maintainer.
3. Land them in the same commit (small changes) or split into two commits (large changes, so one can be reverted without the other).

**To add a roadmap item:** add it to the earliest milestone it could plausibly fit in. Don't pre-commit to a release date — milestones slide; intent is what matters. Aspirational items live in their own section, not the dated milestones.

---

## Part 4 · The `!` shell escape

### 4.1 Syntax

A prompt line whose first non-space character is `!` is a shell escape, not a
message. `!!` is tested before `!`, because the shorter sigil is a prefix of the
longer one — checked the other way round, `!!ls` would run the command `!ls`.

| Input | Runs | Model sees |
|---|---|---|
| `!<command>` | yes | no |
| `!!<command>` | yes | command + output |
| `!cd <path>` | no subprocess — the TUI moves itself | always, either sigil |
| `!` alone | no | no — the row is the usage note |

The escape is refused, with a one-line note and no subprocess, when the command
is empty or another `!` command is still in flight. A note rather than a shell
row: nothing ran, so there is no command and no output to show.

### 4.2 The working directory

The **process** working directory is authoritative. `!cd` calls `process.chdir`,
so later `!` commands and the model's own file tools resolve relative paths
against the same directory. `process.chdir` is called in exactly one place,
[`hooks/useShell.ts`](./../src/hooks/useShell.ts) — the same single-door
discipline `process.exit` gets.

This is safe because the prompt is only `active` while
`state.status === 'idle'`, so a `cd` cannot land between a running turn's tool
calls and the relative paths they have already resolved.

Two things record where the session *started* and correctly do not follow a
`cd`: the banner (it is inside `<Static>` — written to the terminal once) and the
session header's frozen `meta.cwd`. `readRepoLabel`'s memo, by contrast, **is**
keyed by directory: a process-wide memo would answer with the branch of a
directory the user has left, and that answer looks entirely plausible.

A successful `cd` is injected into the session whether it was written `!` or
`!!`. This is the one case where the view-only default would do damage rather
than withhold a convenience — every relative path the model uses afterwards
means something else, and it has no other way to find out.

Only a line that is *entirely* a `cd` invocation is intercepted: `cd`, `cd ~`,
`cd -`, `cd <path>`, and one quoted operand. `cd src && ls` goes to the shell
whole, where its directory change dies with the child exactly as in a shell
script. The alternative is this parser holding an opinion about `&&`, `;`, `|`
and subshells in order to guess which half to keep.

### 4.3 The child process

- `stdio` is `['ignore', 'pipe', 'pipe']`. Never `inherit`: Ink owns the screen
  and raw-mode stdin, and a child sharing them would read the user's keystrokes
  out from under the prompt. Never a live stdin: a command waiting for input
  would wait forever against a terminal that will never give it any. `'ignore'`
  turns that hang into an immediate end-of-file.
- stdout and stderr are concatenated **in arrival order** into one stream, which
  is what a real terminal shows. Separating them would move a build's errors away
  from the lines that explain them.
- Shell: `$SHELL` or `/bin/sh` with `-c`; on Windows `%ComSpec%` or `cmd.exe`
  with `/d /s /c`.
- Timeout `SHELL_TIMEOUT_MS` (120s): `SIGTERM`, then `SIGKILL` after a grace
  period. Ctrl-C aborts the same way, and outranks both the turn-cancel and the
  exit branches of the interrupt dispatch — a `!` command can only be submitted
  while the agent is idle, so the two are never both running.
- Output cap `SHELL_MAX_BYTES` (128 KiB), measured in UTF-8 bytes because that
  is what the pipe delivers, and cut back to a whole code point so the result is
  never a lone surrogate half. The **head** is kept: a command that produces too
  much is almost always one whose interesting part is at the top. Hitting the cap
  does **not** kill the child — that would report an exit status the command
  never produced.

### 4.4 Approval, deliberately absent

`!` commands do not go through `ApprovalService`. That seam exists to gate what
the *model* does; a human who typed `!rm` already has a terminal, and asking them
to approve their own keystroke is ceremony, not safety.

### 4.5 The row

One `shell` `UiEntry`: the echoed command, the program's own output, and at most
one status row. Outcome lives in fields (`exitCode`, `signal`, `timedOut`,
`truncated`, `injected`) rather than baked into `output`, so the suffixes stay
translatable and the state layer stays free of presentation. `output` is the
program's bytes and is **never** translated.

A command that exited `0` with intact output gets no status row at all — it
reports success by having worked.

The status row is drawn `wrap="truncate"`, so it is exactly one row in every
language and at every width. That is what lets `scroll.ts` know a shell entry's
height without knowing which catalog is loaded; see §3.10 and AGENTS.md rule 12.

### 4.6 Out of scope

Interactive and full-screen commands (`vim`, `top`, `less`). Supporting them
means unmounting Ink, handing the terminal over with `stdio: 'inherit'`, and
remounting — including re-emitting a `<Static>` banner that by construction
writes once. Also out: shell history, path completion after `!`, and piping a
command's output into the next prompt.
