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
│  tui-01e62198 · v0.2.1-rc.5       deepseek-official/deepseek-v4-flash   │
│  ~/Desktop/dsh-tui (main*)           Tip: /help · /status · Tab completes │
╰──────────────────────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────────────────────────────╮
│ > Ask dsh anything…                                                      │
╰──────────────────────────────────────────────────────────────────────────╯
```

## Install

Needs Node ≥ 22.19, a real TTY (iTerm / Terminal.app / Windows Terminal + PowerShell 7 — not legacy conhost `cmd.exe`), and a DeepSeek API key.

This package is published on npm as **`@qiao-qyn/dsh-tui`** (it is *not* in the `@deepseek-ai` scope). It is a bundle for `dsh`, so: install the launcher once, then mount the bundle into a profile.

Build the tarball from this branch with `pnpm install --frozen-lockfile && pnpm run build && npm pack`. Substitute its absolute path below.

```sh
# 1. the launcher (once per machine)
npm install -g @deepseek-ai/dsh@0.2.1-rc.5

# 2. Create a separate profile for the rc.5 runtime
mkdir -p ~/.dsh/profiles/tui-rc5 && cd ~/.dsh/profiles/tui-rc5
npm init -y
npm install --save-exact @deepseek-ai/dsh-base@0.2.1-rc.5 /absolute/path/to/qiao-qyn-dsh-tui-0.2.1-rc.5.tgz
npm pkg set 'dsh.profile.bundles[0]=@deepseek-ai/dsh-base' 'dsh.profile.bundles[1]=@qiao-qyn/dsh-tui'

# 3. Set DEEPSEEK_API_KEY in ~/.dsh/.env, then start the profile
dsh --profile tui-rc5
```

**Windows (PowerShell 7 + Windows Terminal):**

```powershell
npm install -g @deepseek-ai/dsh@0.2.1-rc.5
$p = "$env:USERPROFILE\.dsh\profiles\tui-rc5"
New-Item -ItemType Directory -Force -Path $p | Out-Null
Set-Location $p
npm init -y
npm install --save-exact @deepseek-ai/dsh-base@0.2.1-rc.5 C:\path\to\qiao-qyn-dsh-tui-0.2.1-rc.5.tgz
npm pkg set 'dsh.profile.bundles[0]=@deepseek-ai/dsh-base' 'dsh.profile.bundles[1]=@qiao-qyn/dsh-tui'
dsh --profile tui-rc5
```

> When npm reports blocked dependency builds, use `npm install-scripts ls` to review them. With pnpm, use `pnpm approve-builds` for native dependencies required by the profile. On Windows, if the dep tree trips `ENAMETOOLONG`,
> install the profile closer to the drive root (`C:\tui`) or set
> `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem` → `LongPathsEnabled=1`.

An isolated profile can set `DSH_HOME` to keep sessions, patches and TUI preferences together. On rc.5, `!cd` changes the active session’s working directory.

## Use it

Type a message and **Enter** sends it. **Esc** cancels the running turn. **`/exit`** leaves.

| | |
| --- | --- |
| `/changes` | Show recorded files, line changes and command outcomes for the latest task or `/changes N` |
| `/queue` | List pending input; `add <text>`, `edit <id> <text>`, `remove <id>`, `clear` manage separate turns |
| `/notify` | `/notify off` / `bell` / `desktop`; `/notify test` probes delivery; default off |
| `/mouse` | `auto` / `on` / `off`; F2 toggles mouse reporting and native text selection |
| `/activity` | Expand/collapse a completed task: `/activity <number>`, `all`, or `none` |
| `/search` / `/jump` | Search full text; jump to result number, `next`, `prev`, `user`, `tool`, or `error` |
| `/inspect` | View a complete entry by number; Esc returns to the conversation |
| `/export` | Export Markdown: `/export <path> [--entry=N]`; existing files are preserved |
| `/resume ` / `/sessions ` | Search and select stored sessions by title, directory or id; Enter resumes |
| `/diff` | Inspect recorded applied file changes; `/diff N` limits to an entry |
| `/retry` | Inspect failed work; `continue` resumes from recorded results, `draft` restores request text |
| `/branch` | Create a conversation branch, optionally at an earlier turn: `/branch N` |
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
| `/copy` | Copy the latest reply; `/copy code` copies a code block; `/copy N` copies entry N |
| `/verbose` | show more of long output (`Ctrl-O` is the same switch) |
| `/keybinds` | `default` or `vim` prompt mode |
| `/provider`, `/plugins` | mounted LLM routes; loaded plugins |
| `/sessions` | List sessions; `all` / `archived` filter; `rename <id\|current> <title>`; `favorite` / `archive <id\|current> on|off` organize |
| `/resume` | Resume by id or `last`; Ctrl-G opens the picker while preserving the draft |
| `/history` | show or hide the history a resumed session came with |
| `!`, `!!` | run a shell command — `!!` also shows it to the model |
| `/exit`, `/quit` | leave the REPL |
| `Ctrl-Z` / `Ctrl-Y`, `Ctrl-R` | Undo / redo input; Vim normal-mode `u` also undoes |
| `Ctrl-G` | Open the session chooser while preserving the draft; Esc returns |
| `Ctrl-X` | Remove the draft image at the caret, or the last image; metadata preview appears before sending |
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

Apple Terminal uses mouse reporting under `/mouse auto` to deliver wheel events. F2 or `/mouse off` restores native selection; `/mouse on` restores reporting. Enable Terminal.app’s Allow Mouse Reporting setting if reports are disabled in its profile. Other terminals keep alternate-scroll input under auto. Completed tasks retain event-derived elapsed time and collapse intermediate activity while final answers and failures stay visible.

Background diagnostics are recorded in `tui.log` under `DSH_HOME` (normally `~/.dsh/tui.log`). With mouse reporting enabled, click a task summary to expand it; F2 restores native text selection.

Manual acceptance: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

Drafts autosave per session under `DSH_HOME/tui-drafts` and restore when that session is resumed. Submitting clears the saved draft.

## License

MIT
