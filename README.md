# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

A Claude Code-style terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It's a single Cordis bundle (`tui-runner`) that mounts on top of `dsh-base` and replaces the default web UI with a full-screen Ink REPL. Same Agent, same tools, same model — just a terminal.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ds · deepseek-official/deepseek-chat   session:tui-7a3  ⏵ idle  in:0 out:0│
└──────────────────────────────────────────────────────────────────────────┘

 ┌────────────────────────────────────────────────────────────────────────┐
 │ > What files are in this directory?                                    │
 └────────────────────────────────────────────────────────────────────────┘
   ┌─ bash ─────────────────────────────────────────────────────────────┐
   │ ls -la                                                             │
   └────────────────────────────────────────────────────────────────────┘
   total 12
   drwxr-xr-x  3 user  staff   96 Aug 19 10:30 .
   drwx------  5 user  staff  160 Aug 19 10:30 ..
   -rw-r--r--  1 user  staff  403 Aug 19 10:30 README.md
   ✓ ok

╭──────────────────────────────────────────────────────────────────────────╮
│ > Ask dsh anything…                                                      │
╰──────────────────────────────────────────────────────────────────────────╯
```

## Use it

```sh
# 1. Install dsh (one time)
npm install -g @deepseek-ai/dsh

# 2. Create a profile
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
pnpm init
pnpm add @deepseek-ai/dsh-base @deepseek-ai/dsh-tui
echo '[]' > cordis.yml

# 3. Launch
export DEEPSEEK_API_KEY=sk-...
dsh --profile tui
```

In the REPL: type a message and press **Enter** to send; **Ctrl-C** cancels the current turn; **`/exit`** leaves.

| Command | Effect |
| --- | --- |
| `Enter` | Send the current input as a user message to the model |
| `/help` | Print available slash commands |
| `/clear` | Clear the visible chat (the session log is unchanged) |
| `/status` | Print the current model and session id |
| `/exit`, `/quit` | Leave the REPL |
| `Ctrl-C` (idle) | Same as `/exit` |
| `Ctrl-C` (turn running) | Cancel the in-flight turn |

Requires Node ≥ 22.19, pnpm ≥ 9, a real terminal (Ink needs a TTY), and a DeepSeek API key.

## Develop it

```sh
# 1. Get the source
git clone https://github.com/<your-fork>/dsh-tui.git
cd dsh-tui

# 2. Install deps (build tools + harness peers from npm)
pnpm install
pnpm approve-builds esbuild    # one-time, lets tsdown's bundler run

# 3. Sanity-check
pnpm run typecheck
pnpm test                      # 20 unit tests, ~500ms
pnpm run build                 # tsc → .d.ts,  tsdown → lib/index.js

# 4. Try it locally without publishing
#    Create a link-mode profile that points at this checkout:
mkdir -p ~/.dsh/profiles/tui-dev && cd ~/.dsh/profiles/tui-dev
pnpm init
pnpm add @deepseek-ai/dsh-base @deepseek-ai/dsh-tui@link:/absolute/path/to/dsh-tui
echo '[]' > cordis.yml

export DEEPSEEK_API_KEY=sk-...
dsh --profile tui-dev
```

### The edit / rebuild / restart loop

When you change a file under `src/`, the loader won't see it until you rebuild and restart:

```sh
# in this repo
pnpm run build          # ~30 ms
# in the other terminal
Ctrl-C                  # leave the running dsh
dsh --profile tui-dev   # restart; picks up the new lib/index.js
```

`pnpm test` and `pnpm run typecheck` run against the `.ts` source — they don't need a build.

### Project layout

```
src/
├── index.ts                 Cordis plugin entry: create Agent, render <App/>
├── renderer.tsx             Ink root component
├── state.ts                 Pure reducer: SessionEvent → UiState
├── types.ts                 UiEntry, UiState, isRenderable, declaration-merged event map
├── commands.ts              /help /clear /status /exit /quit dispatch
├── invariant.ts             Empty package-invariant companion
├── hooks/
│   └── useSessionEvents.ts  Replay log + subscribe to session/event
└── components/
    ├── StatusBar.tsx        Top: model · session · status · tokens
    ├── MessageList.tsx      Middle: user / assistant / tool / compaction
    └── Prompt.tsx           Bottom: input box

tests/                       vitest specs for state, commands, apply()
```

| Config file | Purpose |
| --- | --- |
| `tsconfig.json` | Editor + typecheck (`noEmit: true`, `allowImportingTsExtensions: true`) |
| `tsconfig.dts.json` | Extends base; declaration-only emit into `lib/types/` |
| `tsdown.config.ts` | Runtime bundle: `src/index.ts` → `lib/index.js` |
| `vitest.config.ts` | Test discovery: `tests/**/*.spec.ts` |
| `cordis.patch.yml` | The patch this bundle applies to `dsh-base` on install |

### How the view works

The Ink tree is a **pure projection** of the Agent's session log. The reducer in [`src/state.ts`](src/state.ts) maps each `SessionEvent` to a `UiEntry` (user, assistant, tool call, compaction, plan, note). `useSessionEvents` ([`src/hooks/useSessionEvents.ts`](src/hooks/useSessionEvents.ts)) seeds from the durable log on first render, then keeps the view in sync with each `session/event` arrival. Adding a new event type means: (1) add the type to `SessionEventMap` if it isn't already, (2) add a case in the reducer, (3) render the new entry in `MessageList`.

## Publish it

```sh
# 1. Bump version in package.json (and bump peer packages in lockstep if needed)
# 2. Update version pins in README.md
# 3. Build
pnpm run build
# 4. Publish
npm publish --access public
```

The version is `0.1.0-rc.7`, in lockstep with the `dsh-*` peer packages. Bump them together when shipping a coordinated release. See `package.json#peerDependencies` for the full list.

## Known limitations

- **Single-line prompt.** Multi-line input uses a `\` + Enter continuation marker. A real multiline editor is deferred.
- **No session resume.** Every boot creates a fresh `SessionId` (`tui-<uuid>`).
- **No tab completion or `@`-mention file picker.**
- **`/compact` is not wired up.** The TUI has no manual compaction entry point; `dsh-base` decides autonomously.
- **`ctx.appExit` is launcher-owned.** Outside the `dsh` CLI, the bundle fails loud until the host provides an exit hook.

## License

MIT
