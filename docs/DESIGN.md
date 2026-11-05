# Terminal command menus

The visual contract remains SPEC Part 1 and the existing `/model` picker shown
in the user reference. This is an Ink library: DOM tooling, Lighthouse, CSS
motion and browser menus do not apply.

## Primitives and states

Reuse SlashPalette: full available width, round cyan border, one column of
horizontal padding, cyan/black selected row, dim descriptions, terminal font.
Measure CJK with displayWidth; truncate each item to one physical row. Window
items using the existing terminal-height budget. No animation or new dependency.

The reusable command tree separates navigation from dispatch. A branch opens a
child page; a leaf either dispatches a complete existing command or fills an
editable buffer for free text. Selection never dispatches a branch. Current
settings carry a check mark. Empty/filter-miss pages explain the missing choice
and never dispatch. Esc clears the query, returns to the parent, then closes;
Tab fills a leaf without execution. Complete manually typed commands remain valid.

All strings use the bilingual catalog. Existing model, skill, permission and MCP
preset pickers remain available. Tests render real Ink frames at narrow and short
sizes as the state showcase; the real PTY script covers terminal input routing.
