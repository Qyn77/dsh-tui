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

Use the one-command installer to check prerequisites, build the source, install
matching **dsh + dsh-base + TUI 0.2.1-rc.5**, and activate a verified profile.
Requires **Node ≥ 22.19 with npm, and Git**. Windows installation supports CMD (`install.cmd`) or PowerShell 7 (`install.ps1`); run the TUI in PowerShell 7 + Windows Terminal.

```sh
# From a checkout; no manual pnpm setup or build needed
node scripts/install.mjs
```

macOS / Linux users can run:

```sh
curl -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/install.sh | bash
```

Windows PowerShell 7 (uses `curl.exe`, not the PowerShell `curl` alias):

```powershell
curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o "$env:TEMP\dsh-tui-install.mjs" && node "$env:TEMP\dsh-tui-install.mjs"
```

Windows CMD:

```bat
curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o "%TEMP%\dsh-tui-install.mjs" && node "%TEMP%\dsh-tui-install.mjs"
```

See **[Installation guide](docs/INSTALL.md)** for Windows commands, options,
API key setup, recovery and troubleshooting. The installer checks tools, disk,
write access and dependency sources before installing, then sets up a user-level
`dsh-tui` command and PATH. **Open a new terminal and run `dsh-tui`** (restart
Windows Terminal completely on Windows). Use `--check` for preflight only or
`--no-path` to leave shell/PATH configuration untouched and use the printed
`node .../launch.mjs` command. Both use the profile's pinned launcher, avoiding
conflicts with global `dsh`. Existing credentials and sessions are preserved;
unmanaged profiles are never overwritten. Stop the TUI before updating.

The script does not install system prerequisites. Harness Desktop and global
`dsh`/pnpm are optional. Before chatting, configure a valid API key or account:
see [API key setup](docs/INSTALL.md#api-key--配置-api-key). Desktop can share
credentials under the same `DSH_HOME`, but its model/plugin configuration and
private Node runtime are not automatically imported or reused; see the
[Desktop compatibility notes](docs/INSTALL.md#harness-desktop--与桌面版一起使用).

> This release is `@qiao-qyn/dsh-tui@0.2.1-rc.5`, paired with
> `dsh-base@0.2.1-rc.5`. Older TUI 0.1.0 prereleases are not compatible with this
> runtime. The one-command installer still builds current source using its frozen
> lockfile; installing the npm plugin alone does not create a runnable profile.

## Use it

On Windows, startup requires Windows Terminal (`WT_SESSION`) and reports an error before taking over the screen when that marker is absent. Run PowerShell 7 there; a `DSH_TUI_TERMINAL` override changes protocol policy, not this host requirement. Windows drive/UNC image paths preserve backslashes; quote paths containing spaces.

Type a message and **Enter** sends it. **Esc** cancels the running turn. **`/exit`** leaves.

| | |
| --- | --- |
| `/changes` | Show recorded files, line changes and command outcomes for the latest task or `/changes N` |
| `/queue` | List pending input; `add <text>`, `edit <id> <text>`, `remove <id>`, `clear` manage separate turns |
| `/notify` | `/notify off` / `bell` / `desktop`; `/notify test` probes delivery; default off |
| `/mouse` | `auto` / `on` / `off`; F2 toggles mouse reporting and native text selection |
| `/checkpoint [list / save <path> / seal <id> / show <id> / restore <id> [confirm]]` | Capture one file before work, seal its intended after-state, preview and restore only if unchanged since sealing. See [checkpoint design](docs/FILE-CHECKPOINTS.md). |
| `/tabs [new / next / prev / close / <id>]` | Sequential session tabs: new / next / prev / close, or select a visited session. Switching is idle-only; closing keeps durable history. No background execution. |
| `/terminal` | Inspect adapter, environment, requested modes and observed events |
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

- **[Website](https://qyn77.github.io/dsh-tui/)** — what it looks like, what it does, and the project overview (English and 中文).
- **[docs/USAGE.md](docs/USAGE.md)** — every feature in detail, plus the full key and command reference.
- **[docs/DEVELOP.md](docs/DEVELOP.md)** — hack on the source: packaged development profile, the edit / rebuild / reinstall / restart loop, project layout, publish flow.
- **[docs/SPEC.md](docs/SPEC.md)** — the design contract: visual rules, roadmap, contributor conventions.
- **[docs/OCR-CI.md](https://github.com/Qyn77/dsh-tui/blob/ci/ocr-review/docs/OCR-CI.md)** — configure the GitHub Actions PR review workflow and its required secrets.

Terminal differences are handled by the adapter layer. Recognized direct Apple Terminal, VS Code, iTerm2, Windows Terminal, VTE, Konsole, Kitty, Ghostty, WezTerm, Alacritty and Warp sessions request mouse reporting under `/mouse auto`. Unknown terminals and tmux/screen default to alternate scrolling. F2 or `/mouse off` restores native selection; `/mouse on` explicitly requests reporting. Terminal.app still needs Allow Mouse Reporting enabled. `/activity` provides a keyboard fallback for task disclosure. Environment detection is evidence, not verified capability: inspect `/terminal` and override inherited terminal identifiers with `DSH_TUI_TERMINAL`.

Background diagnostics are recorded in `tui.log` under `DSH_HOME` (normally `~/.dsh/tui.log`). With mouse reporting enabled, click a task summary to expand it; F2 restores native text selection.

Manual acceptance: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

Drafts autosave per session under `DSH_HOME/tui-drafts` and restore when that session is resumed. Submitting clears the saved draft.

## License

MIT

### Clipboard images

Press **Ctrl-V** to import a clipboard screenshot when the terminal forwards that key. Apple Terminal / VS Code profiles also recognize received `Meta-V` and can try image import after an empty bracketed paste; neither signal is guaranteed for Command-V. The terminal owns Command-V: if it sends no bytes, the TUI cannot intercept it. Terminal.app's **Control-Command-V** may provide a paste signal; image file paths remain a fallback. Normal text paste is unchanged. macOS uses its native pasteboard, Windows uses PowerShell/WinForms, and Linux needs `wl-paste` (Wayland) or `xclip` (X11). SSH image reads default to disabled; `DSH_TUI_REMOTE_CLIPBOARD=host` explicitly reads the remote host, never the client. WSL Windows clipboard access requires `DSH_TUI_WSL_CLIPBOARD=windows` and enabled interop. Imported images remain attachments; cache paths stay out of the prompt.

Images are private, content-addressed files in `DSH_HOME/tui-clipboard` (16 MiB per image, 64 files / 256 MiB cache). Ctrl-X removes a draft attachment, Ctrl-Z undoes the insertion. Cache files remain for restart recovery and undo; keep files referenced by saved drafts before manually cleaning that directory. Sending still checks the attachment store and model image capabilities.

### External draft editor

While idle, press **Ctrl-T** to edit the current draft in `$VISUAL`, then `$EDITOR`, falling back to `vi` (`notepad.exe` on Windows). Executable paths and arguments can be quoted; no shell expansion runs. Use a waiting command such as `code --wait` for GUI editors. Save and exit to return; nonzero exit or errors keep the original draft. Returning never submits automatically and is one Ctrl-Z undo step. UTF-8 output is limited to 2 MiB. The temporary file is private and removed after the editor exits. The draft is flushed before handoff; terminal input, alternate screen, mouse modes and repainting are restored afterward.

### Read-only context inspection

`/context view` lists the current canonical session surface: recorded system instructions, conversation, injected context, attachments and compaction replacements that remain effective. It reads `Session.deriveMessages()`; it never assembles a new prompt or changes model context. Drafts and pending inbox items are excluded and labelled separately. The route/tools belong to the last recorded request header, which can differ from a model selection awaiting its next turn.

`/context request` shows the most recent loop request observed for this session in this process, before provider-specific wire conversion. It excludes later replies and auxiliary title/compaction calls; it does not prove network delivery. After a restart it is unavailable until a new request is observed. Add a numbered row to either command to inspect its full available text, or `tools` to inspect schemas. Scroll normally, then Esc to return. Attachment references are shown without reading image bytes, and adapter-private replay metadata is omitted.

Terminal behavior is composed by a shared adapter service; the implementation and acceptance plan is in [Terminal adapters](docs/TERMINAL-ADAPTERS.md). Remote image clipboard reads now require `DSH_TUI_REMOTE_CLIPBOARD=host` (the remote host clipboard, not the SSH client). WSL Windows clipboard access requires `DSH_TUI_WSL_CLIPBOARD=windows`.

Use **Ctrl-V** for clipboard images in macOS Terminal.app. No permission-requiring native Command-V bridge is installed, and Terminal.app Command-V image paste is not a supported guarantee. Keep typing during image reads; send after completion, or cancel the import with Ctrl-C.

### Guided command choices

Select a command and press Enter to choose its known arguments. Settings show
current values; task/message menus show previews instead of requiring numbers.
Sessions, queue items, MCP servers, plugins, provider models and context records
can be selected through nested menus. ↑/↓ select, Enter chooses, Tab fills without
executing, and Esc clears a filter, goes back, then closes. Type to filter rows.
Ctrl-G keeps the quick resume picker and preserves your draft.

Search words, new titles, queue text, custom MCP configuration and output paths
remain editable. For example, `/export` → choose a message fills
`/export --entry=N `; type the destination path and press Enter. Existing complete
commands still work; dismiss a menu with Esc to use manual syntax. Terminal.app
image imports continue to use Control-V.

Conversation browsing: **F3** opens interactive search (also `/search <text>`),
**F4** selects a message and then offers navigation, full inspection, copy,
recorded changes and Markdown export. Arrow keys select, Enter opens, Esc backs
out; your draft stays intact. Export requires a new file path. `/terminal`
reports the loaded build commit, dirty flag, module path and SHA-256 fingerprint.

**F5** manages draft images: select with arrows, Enter previews locally,
Delete removes that image, Ctrl-Z after closing undoes removal. Local preview
supports macOS Preview and Linux xdg-open; remote/WSL/multiplexed hosts decline.

Compatibility checks run the full test suite, types, build and package exports on macOS, Linux and Windows with Node 22.19.0 and 22.23.1. Native terminal acceptance remains separate. Prompt editing and wrapping preserve whole Unicode graphemes, including emoji and combining marks.
