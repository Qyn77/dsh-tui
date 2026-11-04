# Terminal interaction and visual contract

This is an Ink terminal application. `docs/SPEC.md` owns the detailed design
contract and live backlog. DOM inspection, browser instrumentation and web
framework tooling do not apply to this renderer.

## Preserved identity

Keep the full whale/wordmark, narrow wordmark, and height-constrained compact
welcome states. Retain native text selection, bilingual chrome, and terminal
foreground/background preferences. Cosmetic changes follow functional work.

## Layout

A fixed status header and input surround one scrollable transcript. Reserve
the terminal's last column and enough rows for Ink's eraser. No intermediate
frame may spill outside the viewport. User-message frames fill their content
column. Shared pickers align with the input and retain width while filtering.

## Interaction

Keyboard operation is always available. Wheel events must reach the transcript
without moving the complete terminal viewport. Mouse disclosure follows the terminal input policy; F2 restores native selection
when tracking captures pointer events. Browsing
history never loses the draft or changes the running agent's context.

## Progressive disclosure

Running task activity is visible. On completion, retain the final answer and a
compact task summary with event-derived elapsed time. Details remain available
per task, independently of other groups. Failure and unresolved approvals stay
explicit. Search and selection may temporarily reveal collapsed content.

## Verification

Use bilingual frame tests across terminal dimensions and real PTY/VT replay.
Treat Terminal.app and VS Code wheel behavior as separate manual acceptance
items. Verify width, scroll anchoring, restored terminal modes, and unchanged
agent/session data for every presentation change.

## Background-work controls

Notifications are generic, opt-in terminal signals, with no private task text.
Queue operations address durable message identities rather than shifting list
positions. Plain Enter keeps its immediate-steering behavior. Task summaries
show recorded file/command counts and link to a scrollable detailed report;
missing metadata remains explicitly unknown rather than a clean-worktree claim.

## Draft and editor lifecycle

Each session owns its prompt text and caret. Session navigation through Ctrl-G
preserves the source draft and loads the destination draft. Navigation drafts
are temporary query buffers, never persisted over the source. Undo/redo operates
on the same editing state across keymaps, never across a submitted message or
session switch. Session metadata overlays do not rewrite the canonical log.

## Draft attachments

Images are independent draft items, kept above the text editor as compact,
truncated attachment rows. Clipboard imports use localized image numbers rather
than cache filenames. Text editing, external editors and caret movement operate
on the body; attachment add/remove participates in the same undo history and
per-session autosave. Commands preserve pending images. Internal file paths never
appear in the editor body for an imported image.

Command-V compatibility consumes terminal paste signals (including completed
empty bracketed paste); ordinary nonempty text paste remains text. A terminal
that emits no signal cannot be observed by the TUI. Ctrl-V remains the explicit
image import fallback; no global keyboard or clipboard settings are changed.
