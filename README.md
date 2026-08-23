# `@deepseek-ai/dsh-tui`

English | [中文](README.zh.md)

A Claude Code-style terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It's a single Cordis bundle (`tui-runner`) that mounts on top of `dsh-base` and replaces the default web UI with a full-screen Ink REPL. Same Agent, same tools, same model — just a terminal.

```text
╭──────────────────────────────────────────────────────────────────────────╮
│                                                                          │
│                      ██    ██   ███  ████ ████ ███  ████ ████ ████ █  █  │
│       ▄▄▄▄▄▄         ▀█▄▄█▀    █  █ █    █    █  █ █    █    █    █ █   │
│    ▄██████████▄▄   ▄▄███▀      █  █ ███  ███  ███  ████ ███  ███  ██    │
│   ████  ████  ███████████      █  █ █    █    █       █ █    █    █ █   │
│   ███████████████████████      ███  ████ ████ █    ████ ████ ████ █  █  │
│   ▀█████████████████████▀      █  █  ██  ███  █  █ ████ ████ ████       │
│    █████████████████████       █  █ █  █ █  █ ██ █ █    █    █          │
│      ▀███████████████▀         ████ ████ ███  █ ██ ███  ████ ████       │
│                                █  █ █  █ █ █  █  █ █       █    █       │
│        探索未至之境！           █  █ █  █ █  █ █  █ ████ ████ ████       │
│                                                                          │
│  tui-01e62198 · v0.1.0-rc.7       deepseek-official/deepseek-v4-flash   │
│  ~/Desktop/dsh-tui (main*)           Tip: /help · /status · Tab completes │
╰──────────────────────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────────────────────────────╮
│ > Ask dsh anything…                                                      │
╰──────────────────────────────────────────────────────────────────────────╯
```

The TUI uses the terminal's alternate screen buffer, like `vim` or `htop`.
The startup banner, messages, status bar, and prompt are redrawn as one frame
after a resize settles; the primary shell screen and scrollback are restored
when the REPL exits. The banner has three responsive width tiers: full
whale/wordmark (wide), wordmark (medium), and a compact plain tier (narrow).

## Use it

> macOS, Linux, and Windows. Node ≥ 22.19, pnpm ≥ 9, a real terminal
> (Windows Terminal + PowerShell 7, iTerm/Terminal.app, or any TTY that
> handles ANSI; not legacy conhost cmd.exe), and a DeepSeek API key.

**macOS / Linux (bash, zsh, Git Bash, WSL):**

```sh
# 1. Install dsh (one time)
npm install -g @deepseek-ai/dsh

# 2. Create a profile
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
pnpm init
# @next pins dsh-base to the same 0.1.0-rc.x line as this package;
# the `latest` dist-tag currently points at the abandoned 0.0.1-rc.1,
# which has a transitive dependency that was never published.
pnpm add @deepseek-ai/dsh-base@next @deepseek-ai/dsh-tui
echo '[]' > cordis.yml

# 3. Register the bundles. pnpm add only puts them in node_modules;
#    the dsh launcher reads `dsh.profile.bundles` in package.json to
#    know what to mount. `dsh plugin install` reconciles that list
#    from the installed state.
dsh plugin --profile tui install

# 4. Approve native build scripts once. The sandbox and shell plumbing
#    depend on these binaries.
pnpm approve-builds    # tick: node-pty, koffi, protobufjs, dsh-subprocess-local

# 5. Set the API key once. dsh loads `~/.dsh/.env` on every launch, so
#    you never have to `export` it again. To rotate the key, edit the
#    file in place.
cat > ~/.dsh/.env <<'EOF'
DEEPSEEK_API_KEY=sk-...
EOF
chmod 600 ~/.dsh/.env

# 6. Launch
dsh --profile tui
```

**Windows (PowerShell 7 + Windows Terminal):**

```powershell
# 1. Install dsh (one time)
npm install -g @deepseek-ai/dsh

# 2. Create a profile
$profilePath = Join-Path $env:USERPROFILE ".dsh\profiles\tui"
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
Push-Location $profilePath
pnpm init
# Same @next note as in the macOS / Linux block above.
pnpm add @deepseek-ai/dsh-base@next @deepseek-ai/dsh-tui
Set-Content -Path cordis.yml -Value "[]"

# 3. Register the bundles (same `dsh.profile.bundles` contract)
dsh plugin --profile tui install

# 4. Approve native build scripts once. node-pty and koffi ship
#    prebuilt Windows binaries via prebuild-install, so MSVC is not
#    required unless a build falls back to source compilation.
pnpm approve-builds    # tick: node-pty, koffi, protobufjs, dsh-subprocess-local

# 5. Set the API key once. dsh loads `$env:USERPROFILE\.dsh\.env` on
#    every launch, so you never have to set `$env:DEEPSEEK_API_KEY`
#    again. To rotate the key, edit the file in place.
Set-Content -Path "$env:USERPROFILE\.dsh\.env" -Value "DEEPSEEK_API_KEY=sk-..."

# 6. Launch
dsh --profile tui
Pop-Location
```

> **Windows long paths.** The DeepSeek Harness dep tree is deep; if you
> hit `ENAMETOOLONG` on a fresh checkout, either install the profile
> closer to the drive root (e.g. `C:\tui`) or enable Win32 long paths
> in the registry (reboot required):
>
> ```powershell
> Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1
> ```

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
| `Ctrl-J` | Insert a newline in the input (so does `\` then `Enter`) |
| `↑` / `↓` | Scroll the conversation one row — or move the caret, once the input is more than one row tall |
| `PageUp` / `PageDown` | Scroll one viewport (two rows of overlap) |
| `Ctrl-B` / `Ctrl-F` | The same, without reaching for `Fn` |
| `Ctrl-U` / `Ctrl-D` | Scroll half a viewport |
| `Home` / `End` | Jump to the oldest row / back to the newest |
| Mouse wheel | Scrolls, in terminals that support alternate scroll mode |

The alternate screen has no scrollback, so scrolling is the TUI's own. dsh
asks the terminal to answer the wheel with arrow keys rather than to report
mouse events, so **selecting and copying text with the mouse keeps working
normally** — no modifier needed.

The input box grows as you type, up to 10 rows, and then scrolls inside itself
with a scrollbar on the right — so a long message never pushes the
conversation off the screen. While the box is taller than one row, `↑`/`↓`
move the caret through it; `PageUp`/`PageDown` and `Ctrl-B`/`Ctrl-F` always
scroll the conversation.

## Develop it

**macOS / Linux (bash, zsh, Git Bash, WSL):**

```sh
# 1. Get the source
git clone https://github.com/<your-fork>/dsh-tui.git
cd dsh-tui

# 2. Install deps (build tools + harness peers from npm)
pnpm install
pnpm approve-builds esbuild    # one-time, lets tsdown's bundler run

# 3. Sanity-check + first build
pnpm run typecheck
pnpm test                      # 20 unit tests, ~500ms
pnpm run build                 # tsc → .d.ts,  tsdown → lib/index.js

# 4. Create a link-mode profile that points at this checkout
mkdir -p ~/.dsh/profiles/tui-dev && cd ~/.dsh/profiles/tui-dev
pnpm init
# Same @next note as in `Use it` above.
pnpm add @deepseek-ai/dsh-base@next @deepseek-ai/dsh-tui@link:/absolute/path/to/dsh-tui
echo '[]' > cordis.yml

# 5. Register the bundles + approve native builds
dsh plugin --profile tui-dev install
pnpm approve-builds            # tick: node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. Set the API key (skip if you already did this in `Use it`).
cat > ~/.dsh/.env <<'EOF'
DEEPSEEK_API_KEY=sk-...
EOF
chmod 600 ~/.dsh/.env

# 7. Launch
dsh --profile tui-dev
```

**Windows (PowerShell 7 + Windows Terminal):**

```powershell
# 1. Get the source
git clone https://github.com/<your-fork>/dsh-tui.git
cd dsh-tui

# 2. Install deps
pnpm install
pnpm approve-builds esbuild

# 3. Sanity-check + first build
pnpm run typecheck
pnpm test
pnpm run build

# 4. Create a link-mode profile. Use forward slashes in the @link: spec.
$devProfile = Join-Path $env:USERPROFILE ".dsh\profiles\tui-dev"
New-Item -ItemType Directory -Force -Path $devProfile | Out-Null
Push-Location $devProfile
pnpm init
pnpm add @deepseek-ai/dsh-base@next "@deepseek-ai/dsh-tui@link:$PWD/../dsh-tui"
# $PWD assumes you cloned the repo as a sibling of `.dsh`. Otherwise
# pass the absolute path:  "@deepseek-ai/dsh-tui@link:C:/Users/you/Desktop/dsh-tui"
Set-Content -Path cordis.yml -Value "[]"

# 5. Register the bundles + approve native builds
dsh plugin --profile tui-dev install
pnpm approve-builds            # tick: node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. Set the API key (skip if you already did this in `Use it`).
Set-Content -Path "$env:USERPROFILE\.dsh\.env" -Value "DEEPSEEK_API_KEY=sk-..."

# 7. Launch
dsh --profile tui-dev
Pop-Location
```

> The build in step 3 is **required before the first launch** on every
> platform: the linked `dsh-tui` package exports `lib/index.js`, not
> `src/index.ts`, and the launcher reads it verbatim. `pnpm run build`
> writes it; without that file the loader falls back to whatever stale
> build sits in `lib/`.

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
├── scroll.ts                Pure scroll math + key/mouse parsing
├── prompt-layout.ts         Pure input fold, caret, window, scrollbar
├── message-layout.ts        Pure gutter glyphs, tool call + result summaries
├── width.ts                 Pure display width (CJK counts as two columns)
├── hooks/
│   ├── useSessionEvents.ts  Replay log + subscribe to session/event
│   ├── useMessageListScroll.ts  Scroll offset, key bindings, measured geometry
│   └── useResizeRepaint.ts  Non-TTY resize regression harness
└── components/
    ├── StatusBar.tsx        Top: model · session · status · tokens
    ├── MessageList.tsx      Middle: glyph-gutter conversation viewport
    └── Prompt.tsx           Bottom: auto-growing input box, capped at 10 rows

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
