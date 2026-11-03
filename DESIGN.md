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
without moving the complete terminal viewport. Mouse disclosure is opt-in
where terminal tracking would otherwise capture native selection. Browsing
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
