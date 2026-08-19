# @deepseek-ai/dsh-tui

A Claude Code-style terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Single Cordis bundle (`tui-runner`) mounted on `dsh-base`; replaces the default web UI with an Ink-based REPL. Same agent, same tools, same model — different room.

This file is the brief orientation for AI coding agents working in this repo (Claude Code, Cursor, Aider, etc.). The full design contract — style, roadmap, and contributor conventions — lives in [docs/SPEC.md](docs/SPEC.md). **Read Part 3 (Conventions) before opening a PR.**

## Stack

- TypeScript 5.6, Node ≥ 22.19, pnpm ≥ 9
- Ink 5 + React 18 for the UI
- Cordis 4 plugin model (`dsh.bundle.patch` in `package.json#dsh`)
- tsdown for the runtime bundle, tsc for `.d.ts`
- vitest for tests

## File map

```
src/
├── index.ts                  Cordis plugin entry — side effects
├── renderer.tsx              Ink root — wires state + components
├── state.ts                  Pure reducer: SessionEvent → UiState      [test-first]
├── types.ts                  UiEntry, UiState, declaration-merged events
├── commands.ts               /help /clear /status /exit /quit          [test-first]
├── invariant.ts              Type companion for dsh-invariants (no runtime)
├── hooks/useSessionEvents.ts Replay log + live subscribe
└── components/{StatusBar, MessageList, Prompt}.tsx
tests/                          vitest specs
cordis.patch.yml                patch applied on install
```

## Critical rules

1. **`pnpm run build` is required before the first launch.** The launcher reads `lib/index.js`, not `src/index.ts`. The edit → rebuild → restart loop is in the README.
2. **The reducer (`state.ts`) is pure.** No `Date.now()`, no `Math.random()`, no I/O. Inject clocks and IDs as parameters; the reducer is the test surface for the model layer.
3. **All slash commands must be tested.** Adding a new `/foo` requires a case in `tests/commands.spec.ts` and an entry in the README's slash-command table.
4. **API keys never in chat, code, commits, or issues.** They live in `~/.dsh/.env` (mode `0600`). The repo `.gitignore` blocks `.env*` and allows `.env.example` only. When pasting config that contains a key, redact it as `sk-…`.
5. **Version bumps lockstep with the `dsh-*` peer family.** Bump `dsh-agent`, `dsh-agent-default-model`, `dsh-invariants`, `dsh-llm`, `dsh-session`, and `dsh-tui` together. Don't bump `dsh-base` independently — use the `@next` dist-tag until `latest` is repaired.
6. **TTY required.** Refuse to render without one. Windows means PowerShell 7 + Windows Terminal; legacy `conhost` `cmd.exe` does not work and the REPL should exit with a one-line error.
7. **No `process.exit` outside `commands.ts` and `index.ts`.** Every other file must be unit-testable; rely on `ctx.appExit` or the Ink `waitUntilExit` promise.
8. **Docs track code in the same PR.** When you change anything under `src/`, update the matching section of `README.md`, `README.zh.md`, or [docs/SPEC.md](docs/SPEC.md) in the same commit. New event type → `state.ts` cases + `docs/SPEC.md` Part 3 reducer contract. New slash command → `commands.ts` + `tests/commands.spec.ts` + the slash-command table in both READMEs. New platform behavior → `README.md` "Use it" / "Develop it" sections. New color, glyph, or layout rule → `docs/SPEC.md` Part 1. The spec is the source of truth — stale docs are bugs.

## Common tasks

```sh
pnpm test                # vitest, ~500ms
pnpm run typecheck       # tsc, no emit
pnpm run build           # tsc → .d.ts, tsdown → lib/index.js
pnpm run test:watch      # interactive
```

```sh
# Edit loop after changing src/
pnpm run build           # ~30ms
# in the other terminal
Ctrl-C && dsh --profile tui-dev
```

## When in doubt

- Check [docs/SPEC.md](docs/SPEC.md) first. Style questions belong to Part 1, scope questions to Part 2, and "is this OK to commit?" questions to Part 3.
- For env / build / launch issues, the README has the canonical fix. The TUI has no Host, HTTP, or browser layer — if the fix involves any of those, it's the wrong fix.
- Don't introduce a new dependency without checking the dsh-* peer tree first; native modules need `pnpm approve-builds`.
- When a bug resists the first or second fix, read [docs/lessons/README.md](docs/lessons/README.md) before attempting a third. The index is one line per past case; the linked notes encode diagnostic sequences and ordering invariants that aren't in the code or the spec. Only open a linked note when its one-line takeaway matches the problem.
