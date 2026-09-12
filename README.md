# `@qiao-qyn/dsh-tui`

English | [中文](README.zh.md)

A Claude Code-style terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). One Cordis bundle (`tui-runner`) that mounts on `dsh-base` and replaces the default web UI with a full-screen Ink REPL — same agent, same tools, same model, in your terminal.

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

## Install

Needs Node ≥ 22.19, a real TTY (iTerm / Terminal.app / Windows Terminal + PowerShell 7 — not legacy conhost `cmd.exe`), and a DeepSeek API key.

This package is published on npm as **`@qiao-qyn/dsh-tui`** (it is *not* in the `@deepseek-ai` scope). It is a bundle for `dsh`, so: install the launcher once, then mount the bundle into a profile.

```sh
# 1. the launcher (once per machine)
npm install -g @deepseek-ai/dsh

# 2. a profile that mounts this bundle
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
npm init -y
# @next pins dsh-base to the same 0.1.0-rc.x line as this bundle — `latest`
# still points at the abandoned 0.0.1-rc.1.
npm install @deepseek-ai/dsh-base@next @qiao-qyn/dsh-tui
echo '[]' > cordis.yml

# 3. register the bundles. `npm install` only fills node_modules; the launcher
#    reads package.json#dsh.profile.bundles, and this is what writes it.
dsh plugin --profile tui install

# 4. your key, once. dsh loads ~/.dsh/.env on every launch — no more exporting.
echo 'DEEPSEEK_API_KEY=sk-...' > ~/.dsh/.env
chmod 600 ~/.dsh/.env

# 5. run it
dsh --profile tui
```

**Windows (PowerShell 7 + Windows Terminal):**

```powershell
npm install -g @deepseek-ai/dsh
$p = "$env:USERPROFILE\.dsh\profiles\tui"
New-Item -ItemType Directory -Force -Path $p | Out-Null
Set-Location $p
npm init -y
npm install @deepseek-ai/dsh-base@next @qiao-qyn/dsh-tui
Set-Content cordis.yml "[]"
dsh plugin --profile tui install
Set-Content "$env:USERPROFILE\.dsh\.env" "DEEPSEEK_API_KEY=sk-..."
dsh --profile tui
```

> Prefer pnpm? Same steps with `pnpm add`, plus `pnpm approve-builds` once (tick
> `node-pty`, `koffi`, `protobufjs`, `dsh-subprocess-local`) — npm runs those
> build scripts by default. On Windows, if the dep tree trips `ENAMETOOLONG`,
> install the profile closer to the drive root (`C:\tui`) or set
> `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem` → `LongPathsEnabled=1`.

## Use it

Type a message and **Enter** sends it. **Esc** cancels the running turn. **`/exit`** leaves.

| | |
| --- | --- |
| `/help` | list the slash commands |
| `/status` | model, session id, permission preset |
| `/model` | show the model; `/model <name>` switches it, `/model ` opens a picker |
| `/clear` | clear the visible transcript (the session log is untouched) |
| `/context` / `/usage` | context window, and this session's token spend |
| `/mcp` | connected MCP servers; `/mcp add`, `/mcp remove <server>` |
| `/permission` | pick a sandbox + approval preset |
| `/approval` | show or switch the approval policy (`ask` / `never`) |
| `/skill` | pick and run an invocable skill |
| `/language`, `/theme` | `en` / `zh`; `auto` / `dark` / `light` |
| `/copy` | newest reply to the clipboard; `/copy code` for the newest block |
| `/verbose` | show more of long output (`Ctrl-O` is the same switch) |
| `/keybinds` | `default` or `vim` prompt mode |
| `/provider`, `/plugins` | mounted LLM routes; loaded plugins |
| `/sessions`, `/resume` | list stored sessions; `/resume <id>` or `/resume last` |
| `/history` | show or hide the history a resumed session came with |
| `!`, `!!` | run a shell command — `!!` also shows it to the model |
| `/exit`, `/quit` | leave the REPL |
| `Tab` | complete the highlighted `/` command or `@` path |
| `@` | open the file picker |
| `↑` / `↓`, `PageUp` / `PageDown`, `Ctrl-L` | scroll the conversation / redraw |
| `Ctrl-C` | cancel the turn, clear the input, or exit (it asks first) |

Every command, keybinding and feature in full — `!` escapes, MCP servers,
images, skills, hooks, approvals, session resume, known limitations:
**[docs/USAGE.md](docs/USAGE.md)**.

## Learn more

- **[Website](https://qyn77.github.io/dsh-tui/)** — what it looks like, what it does, and the three-command install (English and 中文).
- **[docs/USAGE.md](docs/USAGE.md)** — every feature in detail, plus the full key and command reference.
- **[docs/DEVELOP.md](docs/DEVELOP.md)** — hack on the source: link-mode profile, the edit / rebuild / restart loop, project layout, publish flow.
- **[docs/SPEC.md](docs/SPEC.md)** — the design contract: visual rules, roadmap, contributor conventions.

## License

MIT
