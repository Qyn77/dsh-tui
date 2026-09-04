# dsh-tui Product Roadmap

This document is the working backlog for the dsh terminal UI. It answers three questions in one place:

- What are we building?
- In what order should we build it?
- What counts as “done” for each milestone?

The project goal is a Claude Code-style terminal REPL for dsh: one viewport, keyboard-first, no browser layer, no hidden host runtime, and a stable chat experience.

## 1. Product goal

The TUI should feel like a dense, single-screen agent console:

- a persistent status bar at the top
- a message log in the middle
- a prompt at the bottom
- streaming model output
- tool/call traces
- slash commands
- fast keyboard iteration
- graceful cancellation and exit

The TUI is not a general terminal app. It is a focused AI chat surface over the dsh agent/session layer.

## 1.1 Plugin compatibility model

The TUI is designed to support plugin integration through the dsh runtime, not by becoming a general-purpose plugin host.

The governing rule is simple:

- The core agent capability remains in dsh itself.
- The TUI stays as the presentation and control layer.
- A plugin is only visible in the TUI when it emits dsh-compatible state updates or session events.

This means the TUI can recognize plugins such as token usage monitors, resource health indicators, tool lifecycle reporters, and session metadata extensions, as long as they integrate with the dsh event/state model instead of trying to render their own independent UI inside the terminal.

Unsupported plugin patterns:

- standalone terminal panels or sidebars
- fully custom layouts that bypass the session/state model
- widgets that require a second renderer or browser-like host
- plugin logic that replaces the actual agent runtime instead of augmenting it

The compatibility contract is intentionally narrow: the TUI should surface plugin information when the plugin speaks the same language as the rest of dsh.

## 2. Design principles

1. Terminal-first, not browser-first.
   - No web UI, no host browser, no remote page layer.
   - Use Ink and the terminal canvas directly.

2. Keep the rendering stable.
   - Avoid broad rerender loops.
   - Any blinking or animated UI must be cheap and non-disruptive to scrolling.

3. Scroll must be predictable.
   - The chat log must support reading history, auto-follow, and manual scroll without snapping back.
   - Prompt churn must not interfere with message log state.

4. The spec is the source of truth.
   - If a UI change affects layout, input, or scroll behavior, also update the relevant spec/doc section.

5. Ship in layered milestones.
   - The first milestones are reliability and chat usability.
   - Advanced features come later once the core REPL is stable.

## 3. Scope by layer

### 3.1 Core TUI shell

Must exist before any advanced features:

- three-zone layout: StatusBar / MessageList / Prompt
- basic theme coloring and box styling
- resize handling
- raw terminal input handling
- Ctrl-C cancellation + idle exit workflows
- slash commands for help/status/exit/quit

### 3.2 Message and session view

The user must be able to read an ongoing session clearly:

- replay session history
- live session event projection
- user messages, assistant messages, tool calls, notes, compaction events
- scroll to older history
- auto-follow when the user is at the tail
- explicit “hidden lines” indicator when scrolled up

### 3.3 Prompt editing

The prompt is the main input surface:

- simple one-line input
- left/right cursor movement
- insertion in the middle of the line
- backspace/delete semantics
- submit on Enter
- continuation with backslash + Enter
- placeholder + custom prompt cursor when idle

### 3.4 Model and tool interaction

Once the core shell is stable:

- show model selection and session id clearly
- show active/inactive state
- render streaming assistant output
- render tool call lifecycle blocks
- show errors and cancellation states

### 3.5 Plugin and runtime integration

The TUI should support modular runtime extensions without sacrificing the core agent loop:

- plugin state appears as session metadata, status updates, or structured events
- usage/cost/health events are displayed in the status bar or message log
- tool-specific extensions remain readable and compact
- the agent conversation itself stays the primary interaction surface

The TUI must not become the source of truth for tool execution or agent reasoning. Those remain in the dsh runtime and its active tools.

## 4. Milestones

**Per-item shipped/pending status lives in [SPEC.md](./SPEC.md) Part 2, not
here.** This section says what each milestone is *for* and what would count as
finishing it; SPEC Part 2 is the ledger of what actually shipped, named feature
by named feature, and it is the one to trust when the two disagree. The
annotations below are a coarse index into it — they exist so that reading this
document alone cannot leave a false impression of how much is still open, which
is exactly what they had started to do.

### v0.1 — REPL core (shipped)

Done or in scope:

- Ink-based REPL shell
- session logger + replay
- slash commands
- prompt input
- status bar
- basic rendering of message events

Definition of done:

- launch in a real TTY works
- prompt accepts text and submits it
- session replay renders cleanly
- Ctrl-C exits or cancels correctly
- no raw terminal regressions

### v0.2 — Editing and history (shipped)

Priority features:

- cursor movement with proper in-line editing — **done**: `prompt-editing.ts`
  owns the caret, and every motion below is a pure function over it
- Home/End support, Delete handling — **done**, with one deliberate deviation:
  `Home`/`End` belong to the MessageList, not the prompt, and `Ctrl-U` scrolls
  a half page rather than killing the line. SPEC §1.6 gives the reasoning
- better prompt editing ergonomics — **done**: `Ctrl-A`/`Ctrl-E`/`Ctrl-K`,
  `Alt-B`/`Alt-F`, `Ctrl-W`
- stronger scroll handling under narrow terminals — **done**: the offset counts
  rows rather than entries, bounded by a real measurement of the mounted list.
  See [the scroll lesson](lessons/message-list-scroll.md)
- history navigation in the prompt — **done**: `Ctrl-P`/`Ctrl-N`, and `↑`/`↓`
  while the buffer is one row tall
- word motions and line kills — **done**: `Alt-B`/`Alt-F` move by word,
  `Ctrl-W` deletes the word before the caret, `Ctrl-A`/`Ctrl-E`/`Ctrl-K` cover
  the line ends
- ~~multiline editor preparation~~ — **done**: the box grows with the buffer to
  `MAX_PROMPT_ROWS` (10), then scrolls internally with a scrollbar; `Ctrl-J`
  inserts a newline and `↑`/`↓` walk the caret by row. `prompt-layout.ts` holds
  the fold/caret/window arithmetic, including the remembered desired column:
  walking down through a short row and back up returns the caret to the column
  it started in rather than to the short row's end. The column is measured in
  display columns, so the walk stays under the caret through CJK too.

Definition of done:

- user can move within text without always appending at the end
- text editing feels natural in a terminal
- scrolling no longer conflicts with prompt re-renders
- the prompt remains stable under long chat logs

### v0.3 — Runtime clarity (shipped)

Priority features:

- richer tool result rendering — **done**: a tool call is one line,
  `Read(src/scroll.ts) ✓`, with its result previewed beneath and capped at 8
  lines behind a translated `… +N lines` marker. The `round`-bordered card it
  replaced cost four rows of frame before any content
- clearer agent state transitions — **done**: `useRunningClock` drives one
  interval per status transition, and the StatusBar and the Prompt placeholder
  read the same frame index so the glyph is in lock-step
- approvals / running / cancelled states — **done**: `y`/`n`/`Esc` on a card
  beside the Prompt rather than a modal
- better error rendering — **done** in v0.2: network, model and tool errors get
  one uniform block in `red`
- richer slash command discoverability — **done**: the `/` palette filters as
  you type and `Tab` completes the highlighted name
- plugin status integration through dsh events and session metadata —
  **done**: `/plugins` lists package name and lifecycle phase, broken entries
  first, and `enable`/`disable` rewrite the loader config

Definition of done:

- the user can read what happened without guessing the agent state
- tool events remain legible and compact
- failure and cancellation modes are obvious
- plugin-provided usage or status data is visible without breaking the chat flow

### v0.4 — Productivity polish (one item open)

Priority features:

- better log density — **done**: markdown rendering of assistant turns
  (streamed from the first delta, not on finalize), Shiki syntax highlighting
  in fenced blocks, the one-line tool call, and the 8-line output cap
- more explicit scroll status — **done**: one row under the list is reserved
  unconditionally for the "scrolled into history" hint. Reserving it while at
  the tail is deliberate — a row that appears only once you scroll would change
  the viewport height at that moment, and `PageDown` would then size its step
  against a different height than the `PageUp` it undoes
- clearer active state widgets — **done**: `/context` shows window, cumulative
  spend and live occupancy; `/usage` breaks tokens down per turn
- keyboard shortcuts for common actions — **done**: see SPEC §1.6, which is the
  full binding table and the ownership convention that makes it enforceable
- small UX improvements without changing the app model — **done**: auto light
  or dark theme over OSC 11 with a `/theme` override, and `/copy` to the system
  clipboard over OSC 52

**Still open:** nothing — v0.4 is complete. The last item was the truncation
affordance, and it shipped as a *global* switch: `/verbose` and `Ctrl-O` raise
the preview budget from 8 lines to 200 for every entry at once (SPEC §1.5.6).
The per-entry `▾ show more` originally written down here did not ship and is
still blocked on the focus/selection model §6 refuses. Finding that a global
toggle needs no such model is what unblocked the item without reversing the
refusal — the bullet in §6 stands unchanged.

Definition of done:

- the core REPL feels confident and stable
- advanced actions remain discoverable
- the app remains fast in normal use

### v1.0 — Mature terminal agent UI

Priority features:

- richer model switching and plan mode context
- better overall chat ergonomics
- session resume and lightweight persistence
- optional advanced editing and completion features

Definition of done:

- the TUI is comfortable for daily use by developers
- it remains stable under long sessions
- it prioritizes clarity and control over flashy effects

## 5. Near-term backlog

**This list is spent.** All six items shipped across v0.2–v0.4; it is kept as a
record of the order the work was actually taken in, because that order is the
argument §8 makes and it held up. The live backlog is SPEC Part 2 — as of the
`/verbose` switch, v0.1 through v0.4 are all complete and what remains there is
the v1.0 set.

The next items, in order, should be:

1. Prompt editing ergonomics — **done**
   - Home / End
   - Delete / Delete-previous
   - arrow navigation correctness
   - better empty-state cursor placement

2. Scroll robustness — **done**
   - avoid terminal-host viewport interference
   - preserve manual scrolling and auto-follow invariants
   - treat prompt re-renders as non-disruptive to log view

   Two of these cost a lesson each to get right:
   [message-list-scroll.md](lessons/message-list-scroll.md) and
   [prompt-scroll-snaps.md](lessons/prompt-scroll-snaps.md). Read them before
   touching scroll.

3. Better status and run-state rendering — **done**
   - explicit idle/running/blocked states
   - clearer token counters and session metadata

4. Tool-output readability — **done**
   - compact cards, better truncation rules, cleaner error formatting

   The cards ended up *less* compact than the goal implies: the border was
   removed entirely, because a transcript is mostly tool calls and four rows of
   frame per call cost more than they explained.

5. Advanced command and control surface — **done**
   - model switching
   - compact/resume flows
   - richer slash command set

6. Plugin-aware state rendering — **done**
   - recognize dsh-compatible plugin status/events
   - expose usage/health metadata in a compact status view
   - preserve the primary chat loop while rendering auxiliary information

## 6. Avoid doing for now

These are not the right next steps unless they are required by a concrete user story:

- browser-like sidebars or multi-pane layouts
- heavy animation or visual effects
- complicated mouse-driven editing
- broad app-level state machines not tied to the REPL
- large feature work that hides the core chat experience
- plugin UIs that require independent routing or custom terminal hosts
- **a focus or selection model over log entries** — no "current entry", no
  cursor in the transcript, no per-entry expand state. The log is a stream you
  read and scroll, and the prompt is the only thing that holds focus

That last one is load-bearing and gets cited from outside this document, so it
is spelled out rather than left implied by "broad app-level state machines".
SPEC §1.2 states the same refusal, `/copy <n>` was dropped because of it
(SPEC §1.5.5, `src/clipboard.ts`), and the v0.4 truncation item shipped as a
global `/verbose` switch rather than a per-entry `▾ show more` precisely to
stay on this side of it. Reversing it is a deliberate decision to make here first, not
something to discover halfway into implementing an affordance.

## 7. Acceptance rules

A feature is ready when all of the following are true:

- it works in a real TTY
- it has a clear user-facing effect
- it does not break scroll or prompt state
- it is documented in the relevant design docs
- it is covered by tests when behavior is logic-heavy

The first rule is the one the test suite cannot check for you. Everything in
`tests/` runs with no TTY and with color forced off, so anything that queries
the terminal or depends on a color being legible is discharged by running
`pnpm tty-check` in a real terminal and answering its questions. See SPEC §3.4.

For plugin-related work, the feature is also ready only when it is clear that:

- the plugin is integrated through dsh state/events, not through a separate terminal host
- the agent conversation remains functional and readable
- basic file-editing and tool-using agent workflows still work without relying on the TUI itself

## 7.1 Plugin acceptance rules

A plugin is considered compatible when all of the following are true:

- it enhances dsh behavior instead of replacing the agent runtime
- it emits structured session status or events that the TUI can consume
- it keeps the primary chat surface readable and stable
- it does not interfere with cursor movement, prompt editing, or scroll behavior
- it does not hide the underlying agent/tool loop behind custom UI abstractions

The TUI is not a replacement for the dsh runtime; it is the terminal presentation layer for it.

## 8. Recommended implementation order

1. Stabilize the TUI shell
2. Lock down prompt editing semantics
3. Stabilize message log scroll and auto-follow
4. Define and validate the plugin event/state contract
5. Improve tool and status rendering
6. Expand slash commands / runtime clarity
7. Add polish and optional ergonomics

This order reduces the chance of regressions where a prompt, a timer, or a terminal viewport artifact creates the illusion that the chat log itself is broken, and it ensures the TUI remains a thin presentation layer over the real dsh agent runtime.
