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
| `/context` / `/usage` | context window and token spend; `/context view [N\|tools]` inspects the recorded surface, `/context request [N\|tools]` the last captured request |
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
| `Ctrl-T` | Edit the idle draft in VISUAL / EDITOR; save and exit to return |
| `Ctrl-V` / forwarded `Meta-V` | Import a clipboard image into the attachment tray |
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
- **[docs/OCR-CI.md](https://github.com/Qyn77/dsh-tui/blob/ci/ocr-review/docs/OCR-CI.md)** — configure the GitHub Actions PR review workflow and its required secrets.

Apple Terminal and VS Code use mouse reporting under `/mouse auto` to deliver wheel and task-disclosure clicks. F2 or `/mouse off` restores native selection; `/mouse on` restores reporting. Enable Terminal.app’s Allow Mouse Reporting setting if reports are disabled in its profile. Other terminals keep alternate-scroll input under auto. Auto relies on `TERM_PROGRAM`, which can be inherited by external terminals and misidentify them as VS Code; use `/mouse off` or `/mouse on` to override it. Completed tasks retain event-derived elapsed time and collapse intermediate activity while final answers and failures stay visible.

Background diagnostics are recorded in `tui.log` under `DSH_HOME` (normally `~/.dsh/tui.log`). With mouse reporting enabled, click a task summary to expand it; F2 restores native text selection.

Manual acceptance: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

Drafts autosave per session under `DSH_HOME/tui-drafts` and restore when that session is resumed. Submitting clears the saved draft.

## License

MIT

### Clipboard images

Press **Ctrl-V** to import a clipboard screenshot into the attachment tray. Terminals that forward the platform shortcut as `Meta-V` are supported too. A completed empty bracketed paste is treated as an image-paste signal, so Terminal.app users can use **Control-Command-V** (Paste Escaped Text) or Ctrl-V; plain Command-V remains Terminal.app's own paste menu and is not delivered to programs as a key event. Normal terminal text paste is unchanged. macOS uses its native pasteboard; Windows uses Windows PowerShell/WinForms; Linux needs `wl-paste` (Wayland) or `xclip` (X11). These read the clipboard on the machine running dsh (including a remote host over SSH). Missing support reports a message; pasting a file path still works. Imported images appear as compact attachment rows; their cache paths stay out of the input text.

Images are private, content-addressed files in `DSH_HOME/tui-clipboard` (16 MiB per image, 64 files / 256 MiB cache). Ctrl-X removes a draft attachment, Ctrl-Z undoes the insertion. Cache files remain for restart recovery and undo; keep files referenced by saved drafts before manually cleaning that directory. Sending still checks the attachment store and model image capabilities.

### External draft editor

While idle, press **Ctrl-T** to edit the current draft in `$VISUAL`, then `$EDITOR`, falling back to `vi` (`notepad.exe` on Windows). Executable paths and arguments can be quoted; no shell expansion runs. Use a waiting command such as `code --wait` for GUI editors. Save and exit to return; nonzero exit or errors keep the original draft. Returning never submits automatically and is one Ctrl-Z undo step. UTF-8 output is limited to 2 MiB. The temporary file is private and removed after the editor exits. The draft is flushed before handoff; terminal input, alternate screen, mouse modes and repainting are restored afterward.

### Read-only context inspection

`/context view` lists the current canonical session surface: recorded system instructions, conversation, injected context, attachments and compaction replacements that remain effective. It reads `Session.deriveMessages()`; it never assembles a new prompt or changes model context. Drafts and pending inbox items are excluded and labelled separately. The route/tools belong to the last recorded request header, which can differ from a model selection awaiting its next turn.

`/context request` shows the most recent loop request observed for this session in this process, before provider-specific wire conversion. It excludes later replies and auxiliary title/compaction calls; it does not prove network delivery. After a restart it is unavailable until a new request is observed. Add a numbered row to either command to inspect its full available text, or `tools` to inspect schemas. Scroll normally, then Esc to return. Attachment references are shown without reading image bytes, and adapter-private replay metadata is omitted.
