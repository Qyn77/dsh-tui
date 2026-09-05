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

In the REPL: type a message and press **Enter** to send; keep typing while the model works and **Enter** steers it; **Esc** cancels the current turn; **`/exit`** leaves.

| Command | Effect |
| --- | --- |
| `Enter` | Send the current input as a user message to the model — while a turn is running it steers that turn instead of queuing a new one |
| `/help` | Print available slash commands |
| `/clear` | Clear the visible chat (the session log is unchanged) |
| `/status` | Print the current model and session id |
| `/model` | Print the current model; `/model <name>` or `/model <provider>/<name>` switches it |
| `/context` | Print the context window, this session's token spend, and how full the context is now |
| `/usage` | Break this session's token spend out turn by turn |
| `/language` | Switch the interface language: `/language en` or `/language zh` |
| `/theme` | Choose the background the colors assume: `/theme auto`, `dark`, or `light` |
| `/copy` | Copy the newest reply to the clipboard; `/copy code` takes the newest code block |
| `/verbose` | Show more of each long output: `/verbose on`, `off`, or bare to toggle |
| `/plugins` | List the plugins this host loaded, with the lifecycle phase of each; `/plugins enable\|disable <name>` switches one and saves that to the loader config |
| `/sessions` | List the stored sessions, with the id to resume one by |
| `/resume` | Switch to a stored session: `/resume <id>`, or `/resume last` |
| `/exit`, `/quit` | Leave the REPL |
| `Tab` | Complete the highlighted slash command in the `/` palette |
| `@` | Open the file picker; `Tab` or `Enter` inserts the highlighted path |
| `Ctrl-O` | Same switch as `/verbose`, without typing a command |
| `y` / `n` / `Esc` | Answer a tool approval request — the card lists the call's arguments so the answer is about what it would actually do |
| `Esc` | Cancel the in-flight turn or `!` command; never exits |
| `Ctrl-C` (turn running) | Cancel the in-flight turn |
| `Ctrl-C` (half-written input) | Clear the input |
| `Ctrl-C` (idle, empty input) | Ask first; a second `Ctrl-C` is the same as `/exit` |
| `Ctrl-J` | Insert a newline in the input (so does `\` then `Enter`) |
| `Ctrl-P` / `Ctrl-N` | Walk back and forward through this session's inputs |
| `Ctrl-A` / `Ctrl-E` | Jump the caret to the start / end of the input |
| `Alt-B` / `Alt-F` | Move the caret one word left / right |
| `Ctrl-W` / `Ctrl-K` | Delete the word before the caret / to the end of the input |
| `↑` / `↓` | Scroll the conversation one row — or move the caret, once the input is more than one row tall |
| `PageUp` / `PageDown` | Scroll one viewport (two rows of overlap) |
| `Ctrl-B` / `Ctrl-F` | The same, without reaching for `Fn` |
| `Ctrl-U` / `Ctrl-D` | Scroll half a viewport — `Ctrl-U` deletes to the start of the input when there is input to delete |
| `Home` / `End` | Jump to the oldest row / back to the newest |
| `Ctrl-L` | Clear the screen and redraw (nothing else changes) |
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

### Run a shell command

`!` in front of a line runs it as a system command and shows the output in the
conversation:

```
!git status
!npm test
```

`!!` does the same and also shows the command and its output to the model, so the
next thing you ask can refer to what you just saw. Plain `!` keeps it between you
and the terminal.

`!cd` moves the working directory, and it stays moved — later `!` commands and
the model's own file tools both resolve relative paths against it. `cd`, `cd ~`,
`cd -` and `cd <path>` all work. A change of directory is always shown to the
model even when written as `!` rather than `!!`, because it silently redefines
what every relative path afterwards means.

A compound line like `!cd src && ls` is passed to the shell whole, so its
directory change dies with that command — the same as in any shell script. Use
`!cd src` on its own line to move.

Ctrl-C stops a command that is taking too long, and one gives up on its own after
two minutes. Output is capped at 128 KiB; past that the row says so.

Commands that want the whole terminal — `vim`, `top`, `less` — are not supported.
The REPL owns the screen and the keyboard while it is running, so an interactive
command has no way to reach either. It gets no input (an immediate end-of-file)
rather than hanging. Run those in your own terminal.

### Language

The interface speaks English or Chinese. `/language zh` switches it, `/language
en` switches back, and `/language` on its own reports which one is in force.
`cn`, `中文` and `zh-CN` all mean `zh`.

The choice is saved to `~/.dsh/tui.json` and applies to the next launch too, so
it is a one-time decision rather than a per-session one. Nothing else reads that
file — your API key stays in `~/.dsh/.env`.

Two things do not change with it. The banner has already been written to the
terminal by the time you type the command (that is what makes it stay put while
the conversation scrolls), so it returns in the new language on the next
`/clear` or the next launch. And this is the *interface* language, not the
model's: what the assistant replies in is up to what you ask it, exactly as
before.

### Light and dark terminals

At boot the app asks your terminal what color it is drawing on (an OSC 11 query)
and picks a light or dark appearance from the answer. `/theme dark` or `/theme
light` overrides that permanently, `/theme auto` goes back to asking, and
`/theme` on its own reports the current setting and what the terminal said. The
choice is saved to `~/.dsh/tui.json` alongside the language.

What changes is deliberately narrow: the colors inside code blocks, and the
lighter of the two brand blues. Everything else is a *named* terminal color —
`gray`, `cyan`, `yellow` — which your terminal already resolves against its own
background, using the palette you configured. Recoloring those would override
your own choice, so it doesn't. Only the two colors that name an absolute value
need a light and a dark version, and those are the two that get one.

Terminals that don't answer the query are the common case, not an error: the
query is given 100ms, then `COLORFGBG` is consulted, then it settles on dark.
Nothing is printed either way.

### Clipboard

`/copy` puts the newest reply on your system clipboard, and `/copy code` puts the
newest fenced code block there instead. It works over SSH, which is the reason it
exists: the text is handed to your *local* terminal as an escape sequence
(OSC 52), so it reaches the clipboard of the machine you are sitting at rather
than the one the session is running on.

There is one honest caveat and the command states it every time: **the terminal
never answers.** OSC 52 is a write with no reply, so if your terminal has it
disabled, the sequence is discarded in silence and nothing here can tell. The
confirmation therefore says what was *sent*, not what arrived. If nothing pastes,
that is where to look — and under tmux you also need `set-clipboard on` in your
config. GNU `screen` is not supported.

Large replies are cut at 48 KB, and the command says when it cut. There is no
`/paste`: your terminal's own paste already reaches the prompt, and reading the
clipboard back would need the keyboard while the REPL is using it.

### MCP tools

If your assembly mounts `@deepseek-ai/dsh-mcp-client`, the tools it bridges show
up like any other — with a name that says where they come from.

```
⏺ github:create_issue(it broke)
```

The plugin registers them as `mcp__github__create_issue`; the TUI shortens that
to `github:create_issue` so the part you are scanning for is at the end rather
than behind two runs of underscores. Two servers can each provide a `search`,
and this is what tells them apart.

When one of them needs approval, the card says so explicitly:

```
Permission required  github:create_issue
via the github MCP server
```

That line is there because approving a bridged tool is a different decision from
approving a built-in one — the arguments leave your machine for a process the
app did not start.

The TUI takes no dependency on the MCP plugin to do this; it reads the naming
convention. Configuring servers is a bundle concern, one `insert` block per
server in your own patch layer. Note also that the plugin publishes no
connection state, so there is no `/mcp` and nothing here can tell you a server
is down — only that its tools are or are not registered.

### Sending an image

Drag an image file into the terminal and press Enter, and it goes to the model
along with whatever you typed:

```
> here's the failing screen /Users/me/Desktop/shot.png
```

The path is taken out of the text and the image travels as an attachment. What
you see afterwards is a chip inside your own message confirming what went:

```
> ╭──────────────────────────────────────╮
  │ ⧉ shot.png · 1440×900 · 284 KB       │
  │ here's the failing screen            │
  ╰──────────────────────────────────────╯
```

`png`, `jpg`, `jpeg`, `webp` and `gif`. Relative paths, `~/` and quoted or
backslash-escaped paths with spaces in them all work — which covers whatever
form your terminal produces when you drop a file on it.

A path is only attached if it actually points at a readable file, so mentioning
`logo.png` in a sentence does not silently send one. If a file cannot go — too
big, too many, a model that does not take images, no attachment service in your
assembly — you get a note saying why, **and the message is still sent.** A bad
attachment never costs you the line you typed.

There is no clipboard paste for images yet, and nothing renders the picture
itself in the terminal; the chip is the confirmation.

### Seeing more of a long output

A tool result or a `!` command's output is previewed at 8 lines, with a
`… +N lines` marker for the rest. `/verbose` raises that to 200 lines, and
`Ctrl-O` is the same switch without the typing. `/verbose on` and `/verbose off`
set it explicitly if you would rather not guess which way a bare toggle goes.

It applies to **every** entry at once, not to one you point at — there is no
"current entry" in the transcript to point at. It is not remembered between
sessions, and toggling it while you are scrolled up will move the text under
you, because expanding adds rows below your position as well as above it.

### Picking up an earlier session

`/sessions` lists what is stored, newest first: a shortened id, when it started,
where it was running, and the first thing you said in it. The one you are in is
marked.

Switch to one with `/resume`:

```
/resume tui-9f3c1a2b   the id as /sessions prints it
/resume last           whichever was newest
```

The session you leave is not lost — it stays in the store and `/sessions` still
lists it, so switching back is another `/resume`.

The shortened id is enough as long as it matches one session; if it matches two,
you are told so rather than dropped into the wrong history. The same ids work at
launch, if you would rather start where you left off:

```bash
DSH_TUI_RESUME=tui-9f3c1a2b dsh --profile tui
DSH_TUI_RESUME=last dsh --profile tui
```

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

### `pnpm tty-check`

The test suite runs with no TTY and with color forced off, so three shipped
features are only ever exercised as arithmetic: the OSC 11 background probe, the
OSC 52 clipboard write, and whether the colors picked from those two are legible
on your actual background.

```sh
pnpm tty-check          # run it in the terminal you actually use
```

It imports the real modules — no second copy of the sequences — prints what your
terminal answered, and ends two of its four checks with a question, because
"is this readable" and "did that reach your clipboard" are not things a program
can see. Anything you answer "no" to is a real bug the suite cannot catch.

### Project layout

```
src/
├── index.ts                 Cordis plugin entry: create Agent, render <App/>
├── renderer.tsx             Ink root component
├── state.ts                 Pure reducer: SessionEvent → UiState
├── types.ts                 UiEntry, UiState, isRenderable, declaration-merged event map
├── commands.ts              /help /clear /status /language /plugins /exit /quit dispatch
├── i18n.ts                  Pure bilingual string catalog (English + Chinese)
├── shell.ts                 Pure `!` escape parsing, `cd` rules, output clamping
├── shell-runner.ts          The only spawner: runs one `!` command
├── settings.ts              Read/write ~/.dsh/tui.json (the language choice)
├── invariant.ts             Empty package-invariant companion
├── scroll.ts                Pure scroll math + key/mouse parsing
├── prompt-layout.ts         Pure input fold, caret, window, scrollbar
├── message-layout.ts        Pure gutter glyphs, tool call + result summaries
├── width.ts                 Pure display width (CJK counts as two columns)
├── resize.ts                Real-TTY resize owner — debounce, clear, rerender, repaint
├── hooks/
│   ├── useSessionEvents.ts  Replay log + subscribe to session/event
│   ├── useMessageListScroll.ts  Scroll offset, key bindings, measured geometry
│   ├── useResizeRepaint.ts  Non-TTY resize regression harness
│   ├── useShell.ts          Runs `!` escapes; the only caller of process.chdir
│   └── useStrings.tsx       The current language, as React context
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

- **`@` mentions complete a path, they do not attach a file.** Typing `@src/pro` and pressing `Tab` writes `@src/prompt-layout.ts` into the message; the file's contents are not read or inlined. Deciding what goes into a prompt belongs to the harness, not to a text box — and the model has file tools to open the path with.
- **Switching sessions ends the turn you are in.** Every slash command is refused while a turn is running — `/resume` included; cancel with Esc first. There is no way to keep two sessions open side by side.
- **Long tool output is previewed, not expandable.** The first 8 lines are shown with a `… +N lines` marker; there is no `show more` affordance, because reaching one would need a selection model the app deliberately does not have.
- **`ctx.appExit` is launcher-owned.** Outside the `dsh` CLI, the bundle fails loud until the host provides an exit hook.

## License

MIT
