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

- **StatusBar** — model name, session id, run state, token counts. One line, muted, always present at the top.
- **MessageList** — the entire session log, scrollable when it overflows the terminal height. Owns the middle; flex-grows to fill available space.
- **Prompt** — the input line, always the bottom row.

No modal overlays. No sidebars. No tabs in v0.x. The whole screen is the chat. The terminal's resize event is the only thing that changes the layout.

### 1.2 Box-drawing vocabulary

| Element | Border | Why |
|---|---|---|
| StatusBar | `single` (`┌─┐│└─┘`) | Stays on screen permanently; light weight doesn't fight the message list. |
| Tool card | `round` (`╭─╮│╰─╯`) | Friendly, distinct from the status bar. |
| Prompt | `round` (`╭─╮│╰─╯`) | Affordance for an empty input. Cyan when active, gray when a turn is running. |
| User message | none | Floats freely; reads as text, not as a frame. |
| Assistant message | none | Floats freely. |
| Note / compaction / plan | none | Single lines, prefixed with `⤷`. |

Frames are reserved for **persistent chrome** (status bar, prompt) and **self-contained blocks** (tool cards). Message text never gets a frame.

### 1.3 Color palette

The palette is theme-aware. Both light and dark terminals are first-class; `NO_COLOR` disables color entirely.

| Role | Color | Where |
|---|---|---|
| App brand | `cyan` bold | `dsh` in the StatusBar; `>` in the prompt. |
| Model name | `green` | `provider/model` in the StatusBar. |
| User label | `blue` bold | `you` prefix on user messages. |
| Assistant label | `magenta` bold | `assistant` prefix on assistant messages. |
| Tool name | `cyan` bold | Inside tool cards. |
| Tool success border + label | `green` | Tool card with `ok` status; `✓ done`. |
| Tool running border | `yellow` | Tool card with `running` status; `… running`. |
| Tool error border + label | `red` | Tool card with `error` status; `✗ error`. |
| Run state — idle | `gray` | StatusBar status glyph. |
| Run state — running | `yellow` | StatusBar status glyph. |
| Streaming | `yellow` | `· streaming` suffix on the assistant block. |
| Compaction | `cyan` dim | `⤷ compacting…` lines. |
| Plan mode on | `yellow` | `⤷ plan mode on`. |
| Plan mode off | `gray` | `⤷ plan mode off`. |
| Meta / separators | `gray` | `·`, `in:`, `out:`, `session:`, turn/step counters. |
| Notes | `gray` dim | Free-floating side remarks. |
| Empty state | `gray` dim | `Type a message and press Enter. Use /help for slash commands.` |

Colors are semantic, not aesthetic. Don't introduce new colors without a reason in this spec.

### 1.4 Status glyphs

| State | Glyph + label | Color |
|---|---|---|
| Idle | `⏵ idle` | `gray` |
| Running | `⏳ working` | `yellow` |
| (Planned v0.2) Running | animated `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | `cyan` |
| Awaiting approval | `? approve` | `yellow` |
| Cancelled | `⊘ cancelled` | `gray` |

Glyphs are Unicode. Don't draw them with ASCII (`>` `|`) — the round/single box characters are part of the visual identity.

### 1.5 Slash commands

The only commands in the REPL are slash commands. No flags, no sub-commands, no prefixed shortcuts.

| Command | Effect |
|---|---|
| `Enter` | Send the current input as a user message. |
| `/help` | Print the list of available slash commands. |
| `/clear` | Clear the visible chat. The session log is unchanged. |
| `/status` | Print the current model and session id. |
| `/exit`, `/quit` | Leave the REPL. |
| `Ctrl-C` (idle) | Same as `/exit`. |
| `Ctrl-C` (turn running) | Cancel the in-flight turn. |

Slash commands are case-sensitive (`/exit`, not `/Exit`). A line is a slash command iff it starts with `/` and matches a known name; anything else is sent to the model as a user message.

Future slash commands (v0.2+): `/compact`, `/resume <id>`, `/model <id>`, `/cost`, `/copy`. Everything that affects REPL behavior is a slash command.

### 1.6 Keyboard bindings

| Key | Where | Action |
|---|---|---|
| `Enter` | Prompt | Send |
| `Backspace` | Prompt | Delete one char |
| `Ctrl-C` | Anywhere | Cancel turn (when running) or exit (when idle) |
| `\` + `Enter` | Prompt | Insert a newline (multi-line escape for v0.1) |
| `↑` / `↓` | Prompt | History (v0.2) |
| `Tab` | Prompt | Completion (v0.3) |
| `Ctrl-L` | Anywhere | Clear screen, redraw (v0.4) |

### 1.7 Text conventions

- User messages prefixed with `you` label in the MessageList; not echoed in the prompt itself.
- Assistant text starts after the `assistant` label; the turn/step counter is meta and goes in `gray`.
- Tool call results prefixed with the exit status: `✓ done`, `✗ error`, `… running`.
- Errors prefixed with `Error:` and rendered in `red`.
- Notes / compactions / plan toggles use the `⤷` prefix and a single-line layout.

### 1.8 Rendering rules

- **Width-aware.** Layout re-measures on terminal `resize`. No hard-coded widths beyond 80 chars; long output truncates with `…` (see `truncate(text, 240)` in the tool card).
- **No flicker.** Already-emitted messages are static; only the streaming assistant block, the running tool, and the StatusBar re-render.
- **TTY required.** The runner refuses to start without a TTY and prints a one-line error to stderr. Plain pipes are not a use case.
- **Graceful shutdown.** `SIGINT` while a turn is running cancels the turn. `SIGINT` while idle triggers the same path as `/exit`. The runner uses the launcher's `ctx.appExit` and never calls `process.exit` outside `commands.ts` and `index.ts`.

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
- **Streaming markdown.** Render assistant text as it streams, not after the full turn.
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

- Mouse support (click to focus, scroll the MessageList)
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
├── hooks/            # React-only — useInput, useEffect, useState
└── components/       # React components — pure functions of state
```

**Import rules:**

- `state.ts` may import from `types.ts` only.
- `commands.ts` may import from `types.ts` and any type-only package export.
- `hooks/` may import from `state.ts` (as a function call), `types.ts`, and React.
- `components/` may import from `hooks/`, `types.ts`, and React. They do **not** import `state.ts` directly — they receive derived props from the renderer.
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
- Unknown `/foo` returns `{ kind: 'unknown' }` (the Prompt falls back to sending it as a user message; the model will reply that it doesn't know that command).
- Reserved prefixes (`/`, `!`) cannot be redefined.
- Adding a slash command requires:
  1. A case in `commands.ts`
  2. A test in `tests/commands.spec.ts` (every command, every invalid input shape)
  3. An entry in `README.md` and `README.zh.md` slash-command table

### 3.4 Testing

| Surface | Required coverage |
|---|---|
| `state.ts` | 100% (every event type, every branch) |
| `commands.ts` | 100% (every command, every invalid input shape) |
| `hooks/*` | Behavior tests via `renderHook`; one happy path + one error path each |
| `components/*` | Snapshot test for layout + interaction test for input handling |
| `index.ts` | Smoke test: instantiate the plugin with a mock Agent and assert `render` was called |

Use `vitest`. Tests live in `tests/` mirroring `src/`. Run with `pnpm test`. Test files do **not** import from `lib/`; they import from `src/`.

### 3.5 Secret handling

- API keys **never** appear in chat, code, commit messages, or issues.
- The runtime credentials file is `~/.dsh/.env` (mode `0600`). `dsh-app-boot/loadLayeredEnv` reads it on every launch.
- Project-local `.env` and `.env.*` are git-ignored. `.env.example` is allowed and is the place to put a placeholder.
- Rotating the key: edit the env file. No shell restart required; the next `dsh` launch reads the new value.
- When pasting config that contains a key, redact it as `sk-…` or `sk-replace-me`. Never paste a real key.

### 3.6 Platform handling

- **TTY required.** Ink needs a real TTY. Test for `process.stdout.isTTY` at startup; print a one-line error to stderr and exit 1 if missing.
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
