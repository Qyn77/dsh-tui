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
  | `Ctrl-U` / `Ctrl-D` | Half a viewport |
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

**The live frame reserves the terminal's last column.** `App`'s root box carries `marginRight={1}`, and that single column is the other half of rule 7 — the half that applies to everything Ink *does* redraw. Ink stretches the root to the full terminal width, so a framed child emits lines *exactly* as wide as the terminal, and a line that fills the last column leaves the terminal with a wrap decision that terminals do not answer the same way: park the cursor in the last column and let the following newline move down one row (the VT100 reading), or wrap at once so that newline lands a row further down. Under the second reading a 3-row prompt box occupies six physical rows while Ink erases `eraseLines(<logical line count>)` = four, so **every redraw leaks two rows** — which is what a window drag looked like in practice: a ladder of half-drawn prompt boxes, each one column narrower than the last, exactly like the banner ladder that came before it. One reserved column is unwrappable under either reading and also absorbs a one-column lag between `SIGWINCH` and the write, which is what a fast drag does to `stdout.columns`.

**A settled resize repaints the screen.** Terminals may reflow rows already drawn while Ink still tracks logical rows, so cursor-relative erasure cannot be made reliable during a resize storm. The real TTY uses the alternate screen and one owner for resize (`src/resize.ts`): after 120ms of quiet it calls `instance.clear()`, clears the alternate screen, calls `instance.rerender()` exactly once — a rerender rather than a relayout, because `frameHeight` is computed from `stdout.rows` during render — and then repaints through Ink's `useStdout().write`, which re-emits the frame whether or not Ink considers it changed. `tests/resize-repaint.spec.ts` pins the blank-screen cases. The primary screen and shell scrollback are restored on exit. See [the resize lesson](lessons/resize-reflow.md).

`tests/frame-erase.spec.ts` pins both halves by replaying a real six-step drag through a small terminal emulator, under both wrap readings **and** with reflow on and off. All four must end with exactly one prompt on screen, and the surviving row must be a whole one. Without the reserved column the immediate-wrap readings leak; without the repaint the reflowing readings end with six prompt rows, which is the reported bug reproduced. Counting the placeholder rather than the `╭` border is deliberate: under reflow a debris row and the frame drawn beneath it can arrive as one copied line, so borders undercount. The file also measures the StatusBar — the live frame's other framed child, and the one doing its own width arithmetic — from 120 columns down to 20.

No modal overlays. No sidebars. No tabs in v0.x. The whole screen is the chat. The terminal's resize event is the only thing that changes the layout.

### 1.2 Box-drawing vocabulary

| Element | Border | Why |
|---|---|---|
| Banner | `round` `#4D6BFE` | Startup splash; brand blue frames the art. |
| StatusBar | `round` `#4D6BFE` | Persistent chrome in the same brand blue as the banner above it. |
| Prompt | `round` (`╭─╮│╰─╯`) | Affordance for an empty input. Cyan when active, gray when a turn is running. |
| Tool call | none | A marked line, not a block; see the gutter below. |
| User message | none | Floats freely; reads as text, not as a frame. |
| Assistant message | none | Floats freely. |
| Note / compaction / plan | none | Single lines, prefixed with `⤷`. |

Frames are reserved for **persistent chrome** — the status bar and the prompt. Nothing in the conversation gets a frame.

**The conversation is a glyph gutter.** Every entry renders as a fixed two-cell marker column beside a body column: `⏺` for an assistant turn or a tool call, `>` for a user line, `⎿` for a tool's outcome hanging under its call, `⤷` for a lifecycle note. The two-column form is what gives wrapped text a hanging indent — a long turn continues under the body, never back under the marker — and it keeps the conversation's left edge on one column regardless of what an entry is. Entries are separated by a single blank row, applied as a top margin so a tool's outcome stays welded to the call above it.

A tool call is **one line**, `Read(src/scroll.ts) ✓`, with its result abridged to one line beneath. It was a `round`-bordered card through rc.7: four rows of frame before any content, and two columns of extra indent for everything inside it. A transcript is mostly tool calls, so their per-entry overhead is what decides how much conversation fits on screen — the card cost more than it explained. Which argument becomes the subject in `Name(subject)` is chosen by convention (`file_path`, `command`, `pattern`, …) rather than by tool name, because this package does not own the tool registry and cannot enumerate it.

The glyphs, the gutter width, and the one-line summaries live in [`src/message-layout.ts`](./../src/message-layout.ts) as pure functions, and `src/scroll.ts` reads them to estimate how many rows an entry costs. That sharing is load-bearing: the estimate decides how much history stays mounted, and an estimate that *over*-counts stops the mount short of the offset the user is scrolling to, which puts the oldest entries out of reach.

**The prompt cursor.** Ink hides the terminal cursor while in raw mode, so the Prompt renders its own. A stable `▌` (LEFT HALF BLOCK, `cyan` bold) sits at the end of the input whenever the prompt is active. During a running turn the cursor disappears, so a locked prompt never visually invites input. The placeholder switches to `… working` in the same step.

### 1.3 Color palette

The palette is theme-aware. Both light and dark terminals are first-class; `NO_COLOR` disables color entirely.

| Role | Color | Where |
|---|---|---|
| DeepSeek brand blue | `#4D6BFE` | Banner whale + `DEEPSEEK` wordmark; Banner/StatusBar border; tip keys; StatusBar `dsh`. |
| DeepSeek blue, light | `#9BADFF` | `HARNESS` wordmark; the whale's belly row. |
| App brand | `cyan` bold | `>` in the prompt; slash palette border and command names. |
| Model name | `green` | `provider/model` in the StatusBar. |
| User marker | `blue` | `>` in the gutter of a user line. |
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
| Plan mode on | `yellow` | `⤷ plan mode on`. |
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
| `/exit`, `/quit` | Leave the REPL. |
| `Ctrl-C` (idle) | Same as `/exit`. |
| `Ctrl-C` (turn running) | Cancel the in-flight turn. |

Slash commands are case-sensitive (`/exit`, not `/Exit`). A line is a slash command iff it starts with `/` and matches a known name; anything else is sent to the model as a user message.

**Command output is an entry in the conversation, never a write to `stdout`/`stderr`.** The REPL runs inside the alternate screen buffer, where Ink owns every row of the live frame: a direct write lands on rows Ink is driving and is either erased by the next frame or wedged into one. `/help` and `/status` printed to `process.stderr` for exactly this reason and produced nothing a user could read. Output therefore becomes a `command` entry (echoed command line + its text), appended locally by the App — commands never reach the model, so there is no session event behind them and the pure reducer cannot mint one.

A command that has no output prints nothing at all. `/clear` is the case that matters: an entry saying "View cleared." would leave the log one entry long, which contradicts what the user just watched happen *and* suppresses the banner, since the banner renders only on an empty log.

Future slash commands (v0.2+): `/compact`, `/resume <id>`, `/model <id>`, `/cost`, `/copy`. Everything that affects REPL behavior is a slash command. Two of those are blocked on structure rather than effort — see §3.3.1 before picking one up.

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
| `↑` / `↓` | Prompt (multi-row buffer) | Move the caret one row |
| `↑` / `↓` | MessageList (otherwise) | Scroll one row |
| `PageUp` / `PageDown` | MessageList | Scroll a page |
| `Ctrl-B` / `Ctrl-F` | MessageList | Scroll a page (no `Fn` needed) |
| `Ctrl-U` / `Ctrl-D` | MessageList | Scroll half a page |
| `Home` / `End` | MessageList | Jump to the oldest row / back to the tail |
| `Ctrl-C` | App | Cancel turn (when running) or exit (when idle) |
| `Ctrl-L` | App | Clear screen, redraw (v0.4) |

Three rows are decided rather than inherited, and each costs something:

- **`Ctrl-U` scrolls; it does not kill the line.** In readline it is
  kill-to-start, and that muscle memory is real. But `PageUp`/`PageDown` need
  `Fn` on a laptop, `Ctrl-B/F/U/D` are the bindings that make history
  navigable one-handed, and losing half-page scroll is the larger regression.
  The prompt's line-editing keys are therefore drawn from what is left.
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
in state and passes `arrowsScroll` to `useMessageListScroll`. Only the arrows
are negotiable — `PageUp`/`PageDown` and `Ctrl-B/F/U/D` always scroll the log,
so a half-written multi-row message can never lock the log shut.
`tests/prompt-frame.spec.ts` pins both directions.

### 1.7 Text conventions

- User messages are marked with `>` in the gutter and carry no label. The marker already says whose line it is, and a user message has no metadata to hang off a header row — so the text sits on the marker's own row.
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
- **Graceful shutdown.** In raw mode, Ink receives Ctrl-C as a keypress rather than `SIGINT`. While a turn is running it cancels the turn. While idle it unmounts Ink first (restoring the terminal), then triggers the same launcher `ctx.appExit` path as `/exit`. The runner never calls `process.exit` outside `commands.ts` and `index.ts`. See [Lessons → Ctrl-C shutdown](./lessons/ctrl-c-shutdown.md) for the investigation playbook behind this ordering.

### 1.9 Markdown rendering

Finalized assistant turns render a curated subset of GitHub-flavored markdown. The parser lives in [src/markdown.ts](../src/markdown.ts) (pure, no React, no Ink) and the Ink renderer in [src/components/Markdown.tsx](../src/components/Markdown.tsx). Only the assistant block is markdown-aware; user messages, tool calls, and notes remain plain text.

| Construct | Terminal style |
|---|---|
| `#`–`###` heading | `bold`, color step: `cyan` / `magenta` / `gray` |
| `####`–`######` heading | `bold gray` |
| ` ``` fenced ``` ` | `round` border, `gray dim` body, language label in `cyan bold` |
| `` `inline` `` | `cyan dim` |
| `**bold**` | `bold` |
| `*italic*` | `italic` |
| `[label](https://...)` | `underline blue`, label replaced with the URL (no hover on terminal) |
| `-` / `*` unordered list | `▸` bullet, indented one space |
| `1.` ordered list | `1.` `2.` `3.` numeric bullet |
| `> blockquote` | `▏` left bar, `gray dim` content |
| `---` thematic break | `────────────` line |

Raw HTML (`<script>`, etc.) is stripped before the AST is built — see §3.1. Unclosed fences and stray delimiters fall back to a plain `paragraph` so the chat surface never goes blank.

**Spacing and indent normalization.** Paragraphs render with one line of vertical breathing room above and below, so model-written song lyrics and dialog don't look smushed against surrounding blocks. That row is suppressed at the document's own outer edges — a markdown document does not pad its container, because Ink does not collapse margins and the conversation has already decided how much space sits between one entry and the next. The parser pre-strips every leading space and tab at the start of each newline-continued line — the strip runs at the parse boundary (pre-`marked.lexer`) so the model's habit of hand-indenting continuation lines by 10+ spaces does not promote blank-line-separated blocks to a `╭─╮` code frame under CommonMark's 4-space rule. The renderer then applies a uniform **2-space hanging indent** to every soft line break in a text node — a `\n` not followed by another `\n` — so lyrics and dialog continuations read as a hanging indent rather than flush-left (the pre-strip's output) or right-shifted (the model's own 10+-space input). Blank lines (`\n\n`) are preserved end-to-end. Spaces at the very start of the text, and spaces between inline elements (`**bold**` and the next word), are preserved. The indent constant lives in [`src/markdown.ts`](./../src/markdown.ts) as `HANGING_INDENT`; the transform is `applyHangingIndent`.

**Streaming rule.** While a turn is still receiving `assistant/chunk` events, the assistant block stays as raw text. The block re-renders as markdown on the `assistant/message` finalization event. This avoids re-parsing partial input on every keystroke of the model — a half-open code fence or a closing `*` that hasn't arrived yet would otherwise churn the layout, in tension with the lesson in [docs/lessons/prompt-scroll-snaps.md](./lessons/prompt-scroll-snaps.md).

**Out of scope (today).** Tables, images, strikethrough, syntax highlighting, and the "render markdown live while streaming" follow-up are tracked in v0.4.

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
- Single-line prompt with `\` + Enter continuation
- No session resume — every launch creates a new `tui-<uuid>` session
- No tab completion or `@`-mention
- `/compact` is rendered but not user-invoked

### v0.2 — Continuity

- **Multiline editor.** Bracketed-paste detection; `\n` literal stays for v0.1 backwards-compat.
- **Session resume.** On launch, scan for prior `tui-*` session logs and offer `/resume <id>` with the most recent as a default.
- **`/compact` wired.** Invoke `dsh-base`'s compaction action; show the `compacting…` line in the StatusBar instead of in the message list.
- **Spinner during turns.** Replace the static `⏳ working` glyph with the animated `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` cycle.
- **Error rendering.** Network / model / tool errors get a uniform `Error: …` block in `red`; retryable ones show a hint.
- **Markdown rendering.** Assistant turns render a curated subset of GitHub-flavored markdown — see §1.9. Streaming chunks stay as raw text and the block re-renders as markdown on the `assistant/message` finalization event.

### v0.3 — Discoverability

- **Slash-command tab completion.** `Tab` after `/` fills in matching command names.
- **`@`-mention file picker.** `@<Tab>` opens a fuzzy file picker.
- **Tool approval flow.** When a tool call requires consent, render a `y/n/all` prompt inside the Prompt zone, not as a modal.
- **`/model <id>`.** Switch the agent's model mid-session.
- **`/cost` / `/usage`.** Per-turn and cumulative token + dollar cost.
- **History.** `↑` / `↓` navigates the user's prior inputs in this session.

### v0.4 — Polish

- **Syntax highlighting** in assistant code blocks (Shiki, no `node-pty`).
- **Auto theme.** Detect light/dark terminal background and switch palette.
- **Streaming markdown.** Re-parse the assistant text on every `assistant/chunk` event and render partial markdown live, instead of waiting for the `assistant/message` finalization. v0.2 ships the simpler "render on finalize" path; v0.4 is the incremental follow-up.
- **Truncation.** Long tool outputs collapse to a `▾ show more` affordance.
- **Clipboard.** OSC 52 integration for `/copy` and `/paste`.
- **`Ctrl-L` redraw.** Force a full re-render on demand.

### v1.0 — Production

- **Vim / Emacs keybind toggle.** `/keybinds vim` switches the prompt editor.
- **Plan mode.** A `/plan` command that runs the agent read-only and shows a diff before executing.
- **Sub-agent visualization.** Sub-agent outputs render as nested MessageList rows with a `↳` indent.
- **MCP tool surface.** Surface MCP-provided tools with the same approval flow as built-in tools.
- **Hooks visualization.** Render `PreToolUse` / `PostToolUse` hook outputs inline.

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
├── index.ts          # Cordis plugin entry — side effects
├── renderer.tsx      # Ink root — wires state + components
├── state.ts          # Pure reducer — (UiState, SessionEvent) → UiState
├── types.ts          # Type-only — UiEntry, UiState, isRenderable
├── commands.ts       # Pure dispatch — string → CommandResult
├── invariant.ts      # Type companion for dsh-invariants (no runtime)
├── markdown.ts       # Pure markdown → UI AST (no React, no Ink)
├── resize.ts         # Real-TTY resize owner — debounce, clear, rerender, repaint
├── hooks/            # React-only — useInput, useEffect, useState
└── components/       # React components — pure functions of state
```

**Import rules:**

- `state.ts` may import from `types.ts` only.
- `commands.ts` may import from `types.ts` and any type-only package export.
- `markdown.ts` may import from external parsers (`marked`) and `types.ts`. It must not import React, Ink, or any component.
- `hooks/` may import from `state.ts` (as a function call), `markdown.ts` (as a function call), `types.ts`, and React.
- `components/` may import from `hooks/`, `markdown.ts` (for the `Markdown` component and AST types), `types.ts`, and React. They do **not** import `state.ts` directly — they receive derived props from the renderer.
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

### 3.3 Slash command contract

`commands.ts` is a **pure dispatcher**: `(raw: string, ctx: CommandContext) → CommandResult`. The Prompt calls it; the renderer handles the result.

- Slash commands are case-sensitive: `/exit`, not `/Exit`.
- A line is a slash command iff it starts with `/` and matches a known name.
- Unknown `/foo` returns `{ kind: 'unknown' }`. The renderer turns it into a failed `command` entry in the log; it is **not** forwarded to the model, which would spend a turn having the model guess at a typo.
- A `handled` result with no `message` prints nothing. Output that exists is appended as a `command` entry — never written to `stdout`/`stderr`, see §1.5.
- Reserved prefixes (`/`, `!`) cannot be redefined.
- Adding a slash command requires:
  1. A case in `commands.ts`
  2. A test in `tests/commands.spec.ts` (every command, every invalid input shape)
  3. An entry in `README.md` and `README.zh.md` slash-command table
  4. A frame assertion in `tests/command-output.spec.ts` if it prints anything — that its text reaches the screen, which unit tests over `dispatch` cannot see

#### 3.3.1 What the dispatcher cannot express yet

Two commands named as future work in §1.5 are blocked on structure, not on
effort. Both were investigated and deliberately not built; the reasons are
recorded here so the next attempt starts from the blocker instead of
rediscovering it.

`/model` needs three separate changes, none of which is about the command:

- **`dispatch` is synchronous.** The model catalog is not: the only way to
  enumerate what a provider advertises is `ctx.llm.listModels(provider)`, which
  returns a promise. So even a read-only `/model` that just lists the choices
  cannot be written as a `CommandResult` today. Making dispatch async ripples
  into the Prompt's submit path and every command test.
- **Saving the default does not switch the live agent.** `agentDefaultModel`
  has `saveSelection()`, but what actually routes the running agent is the
  `ModelSelectionRef` handed to `installModelSelection(agentCtx, ref)` in
  `index.ts`. That ref lives in `run()`'s closure, created *before* Ink mounts,
  and nothing above the App can reach it. Persisting without mutating it would
  leave the current session on the old model — the worst of the two outcomes,
  because the status bar would agree with the setting and disagree with reality.
- **The status bar would not notice.** `renderer.tsx` reads `currentSelection()`
  through `useMemo(…, [ctx])`, so it is read once per mount and never again.

`/resume` is blocked one layer lower, on where the events would come from:

- `ctx.sessions.list()` returns **live** sessions only. In a freshly launched
  TUI that is our own session and nothing else, so it cannot enumerate history.
- No persistence or storage package is a dependency of this one. The harness has
  a `session-query` plugin, but whether `ctx.sessionQuery` exists at all depends
  on what the launcher mounted, so this package cannot assume it.
- Restoring is otherwise ready: `agents.create` accepts `seed?: readonly
  SessionEvent[]`, and the runtime already distinguishes a seeded create
  (`startup`) from a persisted load (`resume`). `useSessionEvents` also follows
  its agent onto a different session id, which is pinned by a test. What is
  missing is only discovery — and an agent-swap path, since `index.ts` builds
  the agent before `inkRender` and passes it to the App as a prop.

One smaller gap sits underneath both: `dispatch` reads only the first token of
the line, so no command can take an argument yet.

### 3.4 Testing

| Surface | Required coverage |
|---|---|
| `state.ts` | 100% (every event type, every branch) |
| `commands.ts` | 100% (every command, every invalid input shape) |
| `markdown.ts` | Every block-level construct (heading, paragraph, code, list, blockquote, hr) + at least one inline construct + the failure-mode fallback (unclosed fence, stray delimiter) |
| `hooks/*` | Behavior tests via `renderHook`; one happy path + one error path each |
| `components/*` | Snapshot test for layout + interaction test for input handling |
| `resize.ts` | A settled drag always ends with a frame on screen — including the drags that produce a byte-identical frame (height-only, and back to the starting width) |
| Command output | Frame-level, in `tests/command-output.spec.ts`: every command that prints reaches the screen, an unknown command is reported in the log, and nothing is ever written to `stderr`. `dispatch` returning the right string is not evidence the user saw it |
| `index.ts` | Smoke test: instantiate the plugin with a mock Agent and assert `render` was called |

Use `vitest`. Tests live in `tests/` mirroring `src/`. Run with `pnpm test`. Test files do **not** import from `lib/`; they import from `src/`.

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

### 3.10 i18n (docs only)

- **CLI strings: English only.**
- **README: bilingual.** English in `README.md`, Chinese in `README.zh.md`. Update both in the same PR.
- **Spec, comments, commit messages, PR descriptions: English.** Even when the surrounding repo uses Chinese for communication.

### 3.11 Dependencies

- Prefer the existing `dsh-*` peer tree. Don't reach for a new npm package when a peer already covers the need.
- Native modules need `pnpm approve-builds`. The current approval list: `node-pty`, `koffi`, `protobufjs`, `@deepseek-ai/dsh-subprocess-local`. Adding a new native module requires documenting it in the README.
- React/Ink ecosystem is open (`ink`, `ink-text-input`, etc.) but new UI deps should be justified in the PR description.

### 3.12 Docs track code (in the same PR)

Code and docs ship in lockstep. A change to `src/` without a matching doc update is a bug, not a draft.

| Code change | Doc update |
|---|---|
| New `SessionEvent` type | `state.ts` case in `tests/state.spec.ts` + reducer contract section if it introduces a new rule |
| New slash command | `commands.ts` + `tests/commands.spec.ts` + slash-command table in `README.md` and `README.zh.md` |
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
