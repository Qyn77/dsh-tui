# Startup console output and a residual top border

Status: Resolved

## Symptom

Opening `/` in a 120×31 terminal left a single old banner border above the
current banner. Bounding every intermediate frame removed the larger block of
residue but left this row.

## Two independent causes

The first defect was an intermediate frame taller than the viewport. Prompt
picker rows render before their passive effect updates the banner budget.
Inspecting only the final frame missed that transition. Bounding the root and
clipping overflow fixed that defect.

The remaining defect was a late provider diagnostic. Model listing completes
after the first frame and the rc.5 API-key provider reports it through
`console.error`. The runner passed `patchConsole: false` to Ink. This moved the
terminal cursor down one row while Ink's log-update retained its previous line
count. Its next erase started one row too low and left the old top border.

A real PTY capture replayed through a VT emulator reproduced four top borders
instead of three after opening the palette. Its first two rows were identical
banner top borders. The diagnostic arrived after the first banner frame.

## Resolution and verification

Enable Ink's console interception in the runner. Ink clears its managed frame,
writes the diagnostic, and replays the frame while updating its own cursor
bookkeeping. Ink restores the console methods when it unmounts.

The runner regression boots the production entry with real Ink and injects a
late model-listing diagnostic. It requires an erase before that diagnostic,
a frame immediately after it, and restored console methods at teardown.

## Invariants

- A frame that fits can still leave residue if another writer moves its cursor.
- Test both individual frame geometry and the terminal's accumulated screen.
- Keep provider console diagnostics under Ink's ownership throughout UI life.
- A fixture with `patchConsole: false` cannot validate production log handling.
