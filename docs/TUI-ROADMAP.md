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
- user messages, assistant messages, tool cards, notes, compaction events
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

### v0.1 — REPL core (current baseline)

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

### v0.2 — Editing and history

Priority features:

- cursor movement with proper in-line editing
- Home/End support, Delete handling
- better prompt editing ergonomics
- stronger scroll handling under narrow terminals
- history navigation in the prompt
- ~~multiline editor preparation~~ — **done**: the box grows with the buffer to
  `MAX_PROMPT_ROWS` (10), then scrolls internally with a scrollbar; `Ctrl-J`
  inserts a newline and `↑`/`↓` walk the caret by row. `prompt-layout.ts` holds
  the fold/caret/window arithmetic, which is what history navigation will build
  on. What is left: a remembered desired column across short rows, and word
  motions.

Definition of done:

- user can move within text without always appending at the end
- text editing feels natural in a terminal
- scrolling no longer conflicts with prompt re-renders
- the prompt remains stable under long chat logs

### v0.3 — Runtime clarity

Priority features:

- richer tool result rendering
- clearer agent state transitions
- approvals / running / cancelled states
- better error rendering
- richer slash command discoverability
- plugin status integration through dsh events and session metadata

Definition of done:

- the user can read what happened without guessing the agent state
- tool events remain legible and compact
- failure and cancellation modes are obvious
- plugin-provided usage or status data is visible without breaking the chat flow

### v0.4 — Productivity polish

Priority features:

- better log density
- more explicit scroll status
- clearer active state widgets
- keyboard shortcuts for common actions
- small UX improvements without changing the app model

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

The next items, in order, should be:

1. Prompt editing ergonomics
   - Home / End
   - Delete / Delete-previous
   - arrow navigation correctness
   - better empty-state cursor placement

2. Scroll robustness
   - avoid terminal-host viewport interference
   - preserve manual scrolling and auto-follow invariants
   - treat prompt re-renders as non-disruptive to log view

3. Better status and run-state rendering
   - explicit idle/running/blocked states
   - clearer token counters and session metadata

4. Tool-output readability
   - compact cards, better truncation rules, cleaner error formatting

5. Advanced command and control surface
   - model switching
   - compact/resume flows
   - richer slash command set

6. Plugin-aware state rendering
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

## 7.1 Plugin acceptance rules

A plugin is considered compatible when all of the following are true:

- it enhances dsh behavior instead of replacing the agent runtime
- it emits structured session status or events that the TUI can consume
- it keeps the primary chat surface readable and stable
- it does not interfere with cursor movement, prompt editing, or scroll behavior
- it does not hide the underlying agent/tool loop behind custom UI abstractions

The TUI is not a replacement for the dsh runtime; it is the terminal presentation layer for it.

## 7. Acceptance rules

A feature is ready when all of the following are true:

- it works in a real TTY
- it has a clear user-facing effect
- it does not break scroll or prompt state
- it is documented in the relevant design docs
- it is covered by tests when behavior is logic-heavy

For plugin-related work, the feature is also ready only when it is clear that:

- the plugin is integrated through dsh state/events, not through a separate terminal host
- the agent conversation remains functional and readable
- basic file-editing and tool-using agent workflows still work without relying on the TUI itself

## 8. Recommended implementation order

1. Stabilize the TUI shell
2. Lock down prompt editing semantics
3. Stabilize message log scroll and auto-follow
4. Define and validate the plugin event/state contract
5. Improve tool and status rendering
6. Expand slash commands / runtime clarity
7. Add polish and optional ergonomics

This order reduces the chance of regressions where a prompt, a timer, or a terminal viewport artifact creates the illusion that the chat log itself is broken, and it ensures the TUI remains a thin presentation layer over the real dsh agent runtime.
