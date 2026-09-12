# Using dsh-tui in detail

The quick start lives in the [README](../README.md). This document is the
long version of every surface, in English first and Chinese second.

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
convention.

#### Adding a server

Type `/mcp add` and press Enter, and a picker of common preset servers opens —
memory, sequential thinking, docs lookup, a browser, and the everything-demo.
Pick one and Enter writes its row; nothing to paste and nothing to configure.

```
/mcp add memory

  Connected to memory — 9 tools. Written to /Users/you/.dsh/cordis.patch.yml,
  so it comes back next launch.
```

Presets stop where a decision would be needed: a server that wants an API key
or a path to authorize is not in the catalog, because a preset must be safe to
write unseen. For those, `/mcp add` takes the `mcpServers` block a server's
README gives you — the same JSON Claude Desktop and Cursor read. Paste it after
the command and press Enter; a multi-line paste is fine, and a code fence
around it is stripped.

```
/mcp add {"mcpServers":{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}}}

  Connected to filesystem — 11 tools. Written to /Users/you/.dsh/cordis.patch.yml,
  so it comes back next launch.
```

The row goes into `$DSH_HOME/cordis.patch.yml` (`~/.dsh/cordis.patch.yml` by
default), the machine-local patch layer every profile composes last. The
launcher watches that file, so the server connects without a restart, and it is
still there next time. Your comments and `!!js` expressions in that file
survive the write.

`/mcp remove <server>` takes a server back out, by the name `/mcp` lists it
under — including a row you wrote by hand.

Servers can still be configured the old way, one `insert` block per server in
any patch layer, with the per-server `serverName`, `command`/`url` and
transport options as config keys. `/mcp add` writes exactly that shape.

**Credentials are written in plaintext.** The bridge resolves no credential
references, so an API key in a pasted snippet lands in the patch file as
written, and `/mcp add` tells you which variables it just wrote in the clear.
To keep the value out of the file, put `!!js process.env.YOUR_VAR` there
instead and export it in your shell.

`/mcp` lists what that wiring produced: one header per connected server and the
tools it registered, read fresh from the tool registry on every call. The
plugin publishes no connection state, so an absent server shows up as an absent
row — only its tools being or not being registered says whether it is up.

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

### Running a skill

Skills stay out of the `/` palette — a bundle can ship dozens of them, and the
palette is for the fixed command surface. To see what your assembly mounted,
type `/skill ` (with the trailing space): a picker opens listing only
user-invocable skills, each marked with a `◆`:

```
/review    ◆ Read a diff and list what would break in production
```

Walk it with `↑`/`↓`: `Tab` inserts `/<name> ` into the prompt so you can keep
typing arguments, and `Enter` runs the highlighted skill immediately. The
token after `/skill ` filters by prefix, so `/skill rev` narrows straight to
it. `Esc` closes the list without losing what you typed.

You can also name a skill directly, and add whatever it should work on:

```
> /review the auth change
```

`/skill review the auth change` is exactly the same line once dispatched. The
skill's instructions are handed to the model and the turn starts. Your own
words stay your own message; the instructions are not folded into them. The
transcript shows one dim row naming what ran:

```
⤷ skill review
```

Built-in commands win a name collision, then plugin commands, then skills — so
a skill called `clear` neither appears in the picker nor can take `/clear`
away from you. A bare `/skill` prints usage.

### Hook runs

If your assembly mounts a hook bridge (`@deepseek-ai/dsh-hooks-claude-code` or
`@deepseek-ai/dsh-hooks-codex`), each hook that runs leaves a row. Most of them
are quiet — a hook that let the turn carry on is an audit record, drawn at the
same weight as a compaction notice:

```
⤷ PreToolUse hook · pass · claude-code · 12ms
```

A hook that *stopped* something is not quiet, and this is the point of the
feature. Without the row you would be looking at a tool call that never ran with
nothing on screen saying why:

```
⤷ PreToolUse hook · deny · claude-code · 31ms
  refusing: working tree is dirty
```

That row is yellow rather than red. Red here means something failed; a hook that
blocked a call did not fail, it did its job. Anything other than `pass`, `allow`
or `approve` is drawn this way, including a decision this version has never
heard of — a bridge can add to the vocabulary, and a decision we cannot name is
the last thing that should be hidden.

The hook point and the decision are printed in your hook configuration's own
words, untranslated, so you can match the row against the file you wrote.

As with MCP, the TUI takes no dependency on any hook package — it renders the
events if they show up and draws nothing if they do not. Configuring a bridge is
a bundle concern, an `insert` block in your own patch layer.

### Code Mode sub-calls

With `DSH_TOOLS_MODE=code`, the model stops emitting one tool call per action and
writes a small program instead. The program runs in a worker, and the tools it
reaches for are dispatched from inside it. On screen that stays one entry — the
`run_code` call — with a line per dispatch nested under it:

```
⏺ run_code(…)
  ↳ read_file({"file_path":"src/render/scroll.ts"}) ✓ 84 lines
  ↳ write_file({"file_path":"src/render/scroll.ts"}) ✓
  ⎿ done
```

Each dispatch is exactly one row no matter how much it returned, and a failure
adds a second row with the reason — the same two-line shape a denied hook gets,
for the same reason: the thing that went wrong is the thing you need to read.

```
  ↳ read_file({"file_path":"nope.ts"}) ✗
    ⎿ ENOENT: no such file
```

A program that dispatches thirty tools costs thirty rows, and that bound is what
makes the transcript still scrollable — sub-calls are drawn inside the parent
entry rather than as entries of their own, so they carry no blank line between
them and cannot be confused with the next real tool call.

A dispatch still running when the turn ends inherits the parent's fate: `⊘` if
you interrupted, `✓` if the turn completed. Nothing is left spinning.

This is on when `code-runtime` is mounted and `DSH_TOOLS_MODE=code` is set; with
the default tool mode you will never see a `↳` row.

### Workflow runs

If your assembly mounts `@deepseek-ai/dsh-tool-workflow`, the model can fan one
turn out into several child agents. The run draws as a single entry, with a row
per agent under it:

```
⏺ workflow review-changes
  ↳ review:bugs · Review · completed
  ↳ review:perf · Review · failed
  ↳ verify:auth · Verify · running…
```

and gains a closing row once the run itself is over:

```
  ⎿ completed · 3 agents
```

Each agent is one row. The child agents are running whole conversations of their
own, in their own sessions, and none of that is drawn here — thirty agents each
showing their work would bury the conversation that started them.

The outcome is printed in the workflow tool's own word, not translated and not
mapped to a symbol. Only `completed` is quiet; everything else is yellow,
including an outcome this version has never heard of. Yellow rather than red:
an agent that was cancelled did not fail.

If you interrupt the turn, the run closes as `no result` and any agent still
going says `no outcome` rather than spinning forever. Neither invents a word the
workflow never reported.

Sub-agents proper (`@deepseek-ai/dsh-subagent`) look different, and the reason
is worth knowing: a delegation writes its record into the *child's* session log,
not yours. From this transcript a sub-agent is the tool call you can already
see. The workflow tool is the one that reports back into the session you are
watching.

### Approvals, and what survives them

When a tool call needs your authorisation, a card appears beside the prompt
listing the call's arguments; `y` allows it once, `n` refuses it, `Esc` walks
away. That card is live — it is gone the moment you answer.

What stays is a row in the transcript:

```
⤷ approval · shell · allowed-once
⤷ approval · write · rejected
  writes outside the workspace
```

This matters more than it looks. Nothing about the question reaches the model,
and the card cannot outlive the turn, so if the transcript did not record the
answer then resuming the session an hour later would show a tool that never ran
with nothing on screen saying you were the one who stopped it.

A granted call is quiet. Anything else is yellow — refused, cancelled,
`unavailable`, and any outcome this version has never heard of. `unavailable`
is worth recognising: it is what you get when nothing was there to ask, which
is a configuration problem rather than a decision you made. Yellow rather than
red, because a refused call did not fail; that is the gate doing its job.

If the turn ends while a question is still on screen, the row says `no
decision` rather than leaving a question hanging.

Use `/approval` to see which policy this session is on:

```
/approval          # what is in force, and how to change it
/approval ask      # ask before a call that needs authorising
/approval never    # refuse every such call without asking
```

A switch leaves its own row, so a run of silently refused calls is accounted
for rather than looking arbitrary:

```
⤷ approval policy · never
```

Policy rows are never yellow, including `never`. A stricter setting is not a
warning — it is the setting you chose. One that a delegation chose for you is
marked as such.

Only a *switch* leaves a row. The policy your session starts on does not: the
harness records it while building the session, nobody changed anything, and the
preset in the status bar already says what it is.

### Permission presets

Approval policy is one knob; what the sandbox lets a tool touch is the other.
Permission presets bundle both. Type `/permission ` (with the trailing space)
and a picker floats over the choices, ticking the one in force; `↑`/`↓` move,
`Enter` switches, `Tab` just fills the line. There is also a keystroke for the
impatient: **`Tab` / `Shift+Tab` on an empty prompt** steps forward and back
through the presets, wrapping around — the switch submits the same
`/permission <value>` line and leaves the same trail in the log. The same
words also work typed straight at the plugin command,
`/permission <preset>`:

| Preset | Sandbox | Approvals |
|---|---|---|
| `read-only` | nothing writable | ask |
| `workspace-write` | the workspace (default) | ask |
| `danger-full-access` | everything, no sandbox | never asked |

`/permission` is provided by the harness plugin rather than by the TUI, so it
works wherever the plugin is loaded even though it is not a built-in command;
the picker reads its choices from the preset projection and stays absent
without it.

The effective preset is always visible: a chip on the StatusBar's run-state row
and a `permissions:` line in `/status`. Every preset is gray except
`danger-full-access`, which is **bold red** — it removes both gates at once, so
a glance at the chrome settles whether this shell has them. Preset words are
shown verbatim and are not translated.

Booting with `DSH_PERMISSION_MODE=danger-full-access` in the environment starts
straight in that preset; the red chip is how you confirm a shell came up that
way.

### Vim keybinds

`/keybinds vim` puts a normal mode over the prompt. `/keybinds default` takes
it back off, and a bare `/keybinds` tells you which one is on without switching
it — a command you typed to check something should not change it.

Insert mode is the editor you already had. Every readline binding, the `/`
palette, the `@` picker, history recall, paste: all unchanged. Turning vim on
adds a mode and takes nothing away.

`Esc` leaves insert mode. You can tell you are in normal mode because the
prompt marker changes:

```
> what does this do?      ← insert
N what does this do?      ← normal
```

That is the whole indicator, on purpose. A `NORMAL` badge would need a row, and
the frame is a fixed height — a row that appears when the mode changes is a row
drawn on top of the transcript.

What works:

| | |
|---|---|
| Move | `h` `j` `k` `l` `0` `^` `$` `w` `b` `e` `gg` `G` |
| Insert | `i` `a` `I` `A` `o` `O` |
| Delete / change | `x` `D` `C` `dd` `cc`, and `d` or `c` with any motion |
| Paste | `p` `P` — the last thing you deleted |

Words are split on whitespace, not on punctuation, so `~/.dsh/.env` is one
`w`. Most of what you type into a prompt is paths and flags, and vim's usual
word rules would make `w` crawl through them a character at a time.

What does not: counts (`3w`), visual mode, and undo. Undo is the deliberate
one — an undo that covered `dd` but not `Ctrl-W` would be worse than none.

`Esc` still cancels a running turn. In normal mode it is not claimed by the
editor, so it falls through the way it always did; in insert mode it goes to
normal first, and a second one cancels. The `/` palette wins it before either.

The setting is saved to `~/.dsh/tui.json`.

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

The stored history is drawn when the switch lands. If you would rather the
transcript start at the new work, `/history hide` folds it away and
`/history show` brings it back — the model reads the whole log either way, so
this is a screen preference, not a context one. The choice is saved in
`~/.dsh/tui.json` and applies to the next resume too.

The shortened id is enough as long as it matches one session; if it matches two,
you are told so rather than dropped into the wrong history. The same ids work at
launch, if you would rather start where you left off:

```bash
DSH_TUI_RESUME=tui-9f3c1a2b dsh --profile tui
DSH_TUI_RESUME=last dsh --profile tui
```

### Commands and keys

Every slash command, with what it actually does:

| Command | Effect |
| --- | --- |
| `/help` | Print available slash commands |
| `/clear` | Clear the visible chat (the session log is unchanged) |
| `/status` | Print the current model, session id, and effective permission preset |
| `/model` | Print the current model; `/model <name>` or `/model <provider>/<name>` switches it. Typing `/model ` opens a picker over every mounted provider's models — pick one directly instead of guessing names |
| `/provider` | List the mounted LLM provider routes and which one the session is on (read-only; configuring one means editing the llm plugin's config) |
| `/context` | Print the context window, this session's token spend, and how full the context is now |
| `/usage` | Break this session's token spend out turn by turn |
| `/language` | Switch the interface language: `/language en` or `/language zh` |
| `/mcp` | List the connected MCP servers and the tools each one registered; `/mcp add` opens a picker of common preset servers or connects one from a pasted `mcpServers` block, `/mcp remove <server>` takes it back out |
| `/approval` | Show this session's approval policy; `/approval ask` or `never` switches it |
| `/permission` | Plugin command: pick a bundled sandbox + approval preset — `/permission ` opens a picker, or type `read-only` / `workspace-write` / `danger-full-access` directly |
| `/theme` | Choose the background the colors assume: `/theme auto`, `dark`, or `light` |
| `/copy` | Copy the newest reply to the clipboard; `/copy code` takes the newest code block |
| `/verbose` | Show more of each long output: `/verbose on`, `off`, or bare to toggle |
| `/plugins` | List the plugins this host loaded, with the lifecycle phase of each; `/plugins enable\|disable <name>` switches one and saves that to the loader config |
| `/sessions` | List the stored sessions, with the id to resume one by |
| `/skill` | Pick a user-invocable skill: `/skill ` opens a picker, `/skill <name> [args]` runs one |
| `/resume` | Switch to a stored session: `/resume <id>`, or `/resume last` |
| `/history` | Show or hide the stored history a resumed session came with: `/history show` or `hide` |
| `/keybinds` | Choose the prompt's keymap: `/keybinds default` or `vim`; bare reports which is on and changes nothing |
| `/exit`, `/quit` | Leave the REPL |

And every key:

| Key | Effect |
| --- | --- |
| `Enter` | Send the current input as a user message — while a turn is running it steers that turn instead of queuing a new one |
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

The alternate screen has no scrollback, so scrolling is the TUI's own. dsh asks
the terminal to answer the wheel with arrow keys rather than to report mouse
events, so **selecting and copying text with the mouse keeps working normally** —
no modifier needed.

The input box grows as you type, up to 10 rows, and then scrolls inside itself
with a scrollbar on the right — so a long message never pushes the conversation
off the screen. While the box is taller than one row, `↑`/`↓` move the caret
through it; `PageUp`/`PageDown` and `Ctrl-B`/`Ctrl-F` always scroll the
conversation.

## Known limitations

- **`@` mentions complete a path, they do not attach a file.** Typing `@src/pro` and pressing `Tab` writes `@src/prompt/prompt-layout.ts` into the message; the file's contents are not read or inlined. Deciding what goes into a prompt belongs to the harness, not to a text box — and the model has file tools to open the path with.
- **Switching sessions ends the turn you are in.** Every slash command is refused while a turn is running — `/resume` included; cancel with Esc first. There is no way to keep two sessions open side by side.
- **Long tool output is previewed, not expandable.** The first 8 lines are shown with a `… +N lines` marker; there is no `show more` affordance, because reaching one would need a selection model the app deliberately does not have.
- **`ctx.appExit` is launcher-owned.** Outside the `dsh` CLI, the bundle fails loud until the host provides an exit hook.


---

# dsh-tui 详细用法

快速上手见 [README.zh.md](../README.zh.md)。本文是各个界面的长版本，英文在前、
中文在后。

### 执行系统命令

行首加 `!`，这一行就作为系统命令执行，输出显示在对话里：

```
!git status
!npm test
```

`!!` 做同样的事，并且把命令和输出一起给模型看，这样接下来提问就能直接引用刚看到的内容。只用 `!` 的话，这些只留在你和终端之间。

`!cd` 会真的切换工作目录，而且切了就一直生效——后面的 `!` 命令和模型自己的文件工具，解析相对路径时用的都是它。`cd`、`cd ~`、`cd -`、`cd <路径>` 都支持。目录变化总会告诉模型，即使你写的是 `!` 而不是 `!!`，因为它悄悄改变了之后每一个相对路径的含义。

`!cd src && ls` 这种复合行会整行交给 shell，所以它的目录切换随那条命令一起结束——和在任何 shell 脚本里一样。要真的切换，就单独写一行 `!cd src`。

命令跑太久可以用 Ctrl-C 停掉，超过两分钟会自动终止。输出上限 128 KiB，超出的部分会在行尾标明。

需要占满整个终端的命令——`vim`、`top`、`less`——不支持。REPL 运行期间屏幕和键盘都归它，交互式命令碰不到任何一个。它们拿到的是「立即 EOF」而不是卡住。这类命令请在你自己的终端里跑。

### 界面语言

界面有中英两种。`/language zh` 切到中文，`/language en` 切回英文，只打 `/language`
则报告当前用的是哪一种。`cn`、`中文`、`zh-CN` 都算 `zh`。

选择会写进 `~/.dsh/tui.json`，下次启动依然生效，所以这是一次性的决定，不用每个
session 重来一遍。除此之外没有别的东西读这个文件——API key 仍然只在 `~/.dsh/.env`。

有两处不跟着变。banner 在你打这条命令时已经写进终端了（正是这一点让它在对话滚动时
留在原位），所以它会在下一次 `/clear` 或下一次启动时换成新语言。另外，这切的是**界
面**语言，不是模型的：助手用什么语言回你，仍然取决于你怎么问，和以前一样。

### 浅色与深色终端

启动时程序会问终端「你现在画在什么颜色上」（一条 OSC 11 查询），再按回答的亮度选浅色
还是深色。`/theme dark` 或 `/theme light` 可以固定下来，`/theme auto` 回到问终端，只打
`/theme` 则报告当前设置以及终端的回答。这个选择和语言一起写进 `~/.dsh/tui.json`。

变的东西刻意很少：代码块里的配色，以及两种品牌蓝里较浅的那一个。其余全是**具名**终端
颜色——`gray`、`cyan`、`yellow`——终端本来就会用你配置的调色板、对着它自己的背景去解析
它们。再去改一遍等于覆盖你自己的选择，所以不改。只有那两个写死了绝对色值的颜色才需要
浅深两版，也只有它们有。

不回答这条查询的终端是常态，不是错误：查询等 100ms，然后看 `COLORFGBG`，最后落到深色。
无论走哪条路都不会打印任何东西。

### 剪贴板

`/copy` 把最新一条回复放进系统剪贴板，`/copy code` 则放最新的那个代码块。它在 SSH 下
也能用，而这正是它存在的理由：文本是以转义序列（OSC 52）交给你**本地**那个终端的，所以
进的是你面前这台机器的剪贴板，而不是会话所在的那台。

有一个必须说清的前提，命令每次都会重复它：**终端不会回话。** OSC 52 是只写、无回执的，
所以如果你的终端关掉了这个功能，序列会被静默丢弃，这边无从得知。因此确认信息说的是「发
出去了多少」，而不是「到了」。粘不出来就往这里查——在 tmux 下还需要在配置里写
`set-clipboard on`。GNU `screen` 不支持。

过大的回复会在 48 KB 处截断，命令会说明截断了。没有 `/paste`：终端自带的粘贴本来就能送
到输入框，而读回剪贴板需要在 REPL 正用着键盘时抢占它。

### MCP 工具

如果你的装配挂了 `@deepseek-ai/dsh-mcp-client`，它桥接过来的工具和别的工具一样出现，
只是名字会说明它从哪来。

```
⏺ github:create_issue(it broke)
```

插件把它们注册成 `mcp__github__create_issue`；TUI 缩短成 `github:create_issue`，
让你真正要找的那部分落在末尾，而不是藏在两串下划线后面。两个 server 可以各自提供一个
`search`，靠的就是这个区分。

其中某个需要审批时，卡片会明说：

```
需要授权  github:create_issue
经由 github MCP 服务器
```

这行存在的理由是：批准一个桥接工具和批准一个内置工具是两种决定——参数会离开你的机器，
交给一个不是本程序启动的进程。

TUI 为此没有引入对 MCP 插件的任何依赖，它读的是命名约定。

#### 添加一个 server

输入 `/mcp add` 直接回车，会打开一个常见预设服务器的选择器——记忆、多步推理、文档
检索、浏览器，以及演示全部能力的 everything。选中一个再回车，这一行就写好了；不用粘贴，
也不用配置。

```
/mcp add memory

  已连接 memory —— 9 个工具。已写入 /Users/you/.dsh/cordis.patch.yml，下次启动仍在。
```

预设停在"需要做决定"的地方：要 API key 或要授权路径的 server 不进目录，因为预设必须
敢在无人过目的情况下直接写入。那类服务器走粘贴：`/mcp add` 收的就是各家 server 的
README 给你的那段 `mcpServers` JSON——跟 Claude Desktop、Cursor 读的是同一份。粘在
命令后面回车即可；多行粘贴没问题，外面裹的代码围栏会被剥掉。

```
/mcp add {"mcpServers":{"filesystem":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]}}}

  已连接 filesystem —— 11 个工具。已写入 /Users/you/.dsh/cordis.patch.yml，下次启动仍在。
```

这一行落到 `$DSH_HOME/cordis.patch.yml`（默认 `~/.dsh/cordis.patch.yml`），也就是每个
profile 最后叠上去的那层本机 patch。启动器盯着这个文件，所以不用重启就会连上，下次启动
也还在。你在那个文件里的注释和 `!!js` 表达式不会被这次写入吃掉。

`/mcp remove <server>` 把它撤下来，认的是 `/mcp` 列出来的那个名字——手写的行也能撤。

老办法照旧可用：在任一 patch 层里一个 server 一个 `insert` 块，配置键是每个 server 的
`serverName`、`command`/`url`，以及传输选项。`/mcp add` 写出来的就是这个形状。

**凭据是明文写进去的。** 桥接不解析任何凭据引用，所以粘贴片段里的 API key 会原样落进
patch 文件，`/mcp add` 会告诉你它刚刚明文写下了哪几个变量。想让值不进文件，就在那儿写
`!!js process.env.YOUR_VAR`，然后在 shell 里导出。

`/mcp` 列出的就是这份接线的成果：每个连接中的 server 一行表头，下面是它注册的工具，
每次调用都从工具注册表现读。插件不发布连接状态，所以掉线的 server 表现为一个不存在的
行——只有它的工具在不在，能说明它还在不在。

### 发送图片

把图片文件拖进终端，回车，它就跟你打的字一起发给模型：

```
> 这是报错的界面 /Users/me/Desktop/shot.png
```

路径会从正文里摘掉，图片作为附件走。发完你会在自己的消息框里看到一行确认：

```
> ╭──────────────────────────────────────╮
  │ ⧉ shot.png · 1440×900 · 284 KB       │
  │ 这是报错的界面                        │
  ╰──────────────────────────────────────╯
```

支持 `png`、`jpg`、`jpeg`、`webp`、`gif`。相对路径、`~/`、带空格的引号路径和反斜杠
转义路径都认——你的终端拖放时吐出哪种形式都行。

只有真的指向一个可读文件的路径才会被附上，所以句子里提到 `logo.png` 不会莫名其妙
发出去一张图。如果某张图带不上——太大、张数超限、模型不收图片、你的装配里没挂附件
服务——会有一条说明原因的提示，**而且消息照发**。附件出问题绝不会让你白打一行字。

暂时还不支持从剪贴板贴图，终端里也不会真的把图画出来；那行 chip 就是确认。

### 跑一个 skill

skill 不混在 `/` 面板里——一个 bundle 可能带上几十个 skill，而面板是留给
固定指令面的。想看你的装配挂了哪些，输入 `/skill `（带末尾空格）：会弹出一个
只列「允许用户调用」的 skill 的选择器，每行前面带一个 `◆`：

```
/review    ◆ Read a diff and list what would break in production
```

用 `↑`/`↓` 挑选：`Tab` 把 `/<名称> ` 插进输入框，可以接着打参数；`Enter`
立刻执行高亮的 skill。`/skill ` 后面打的一个词会按前缀过滤，所以
`/skill rev` 直接缩到它。`Esc` 关闭列表但不丢你打的字。

也可以直接打出名字，后面跟上要干什么：

```
> /review 看看鉴权那块改动
```

`/skill review 看看鉴权那块改动` 在派发后就是同一行。skill 的指令会交给模型，
然后开始一轮对话。你自己写的话还是你自己的消息，不会被揉进指令里。
transcript 里只会多一行暗色的说明，告诉你跑的是哪个：

```
⤷ 技能 review
```

名字撞车时内置命令最大，其次是插件命令，最后才是 skill——所以一个叫 `clear`
的 skill 既不会出现在选择器里，也拿不走你的 `/clear`。裸 `/skill` 会打印用法。

### hook 执行记录

如果你的装配里挂了 hook 桥接（`@deepseek-ai/dsh-hooks-claude-code` 或
`@deepseek-ai/dsh-hooks-codex`），每次 hook 跑过都会留下一行。多数时候它是安静的
——放行的 hook 只是一条审计记录，权重和压缩提示一样：

```
⤷ PreToolUse 钩子 · pass · claude-code · 12 毫秒
```

**拦下**了东西的 hook 就不安静了，这也正是这个功能存在的理由。没有这一行，你看到的
就是一个没跑起来的工具调用，而屏幕上没有任何东西告诉你为什么：

```
⤷ PreToolUse 钩子 · deny · claude-code · 31 毫秒
  refusing: working tree is dirty
```

这一行是黄色而不是红色。这里的红色表示「出错了」，而拦下调用的 hook 没有出错，
它正是在干自己的活。除 `pass`、`allow`、`approve` 之外的决定都按这个画法，
**包括这个版本从没见过的决定**——桥接可以往词汇表里加东西，而一个我们叫不出名字的
决定，恰恰是最不该被藏起来的。

hook point 和 decision 都按你 hook 配置里的原文打印、不做翻译，这样你能拿这一行
直接对上自己写的那个文件。

和 MCP 一样，TUI 不为此依赖任何 hook 包——事件来了就画，不来就什么都不画。
配置桥接是 bundle 层的事，在你自己的 patch 层里 `insert` 一段。

### Code Mode 的子调用

打开 `DSH_TOOLS_MODE=code` 之后，模型不再一次发一个工具调用，而是写一小段程序。
程序跑在 worker 里，它用到的工具是从程序内部派发出去的。屏幕上这仍然只是一个条目
——那次 `run_code` 调用——每次派发在它下面占一行：

```
⏺ run_code(…)
  ↳ read_file({"file_path":"src/render/scroll.ts"}) ✓ 84 lines
  ↳ write_file({"file_path":"src/render/scroll.ts"}) ✓
  ⎿ done
```

不管返回了多少内容，一次派发就是一行；失败的那次多一行写清原因——和被拦下的 hook
是同一个两行形状，理由也一样：出错的那句话，正是你要读的那句话。

```
  ↳ read_file({"file_path":"nope.ts"}) ✗
    ⎿ ENOENT: no such file
```

派发三十个工具的程序就占三十行，正是这个上限让 transcript 仍然翻得动——子调用画在
父条目**内部**，而不是各自成为条目，所以它们之间没有空行，也不会被看成下一个真正的
工具调用。

回合结束时还没跑完的派发，跟着父条目的结局走：被你打断就是 `⊘`，正常收尾就是 `✓`。
不会有东西一直转下去。

这需要装配里挂了 `code-runtime` 并且设了 `DSH_TOOLS_MODE=code`；默认的工具模式下
你永远不会看到 `↳` 行。

### 工作流

如果你的装配里挂了 `@deepseek-ai/dsh-tool-workflow`，模型可以把一个回合扇出成好几个
子 agent。整个 run 画成一个条目，每个 agent 在它下面占一行：

```
⏺ 工作流 review-changes
  ↳ review:bugs · Review · completed
  ↳ review:perf · Review · failed
  ↳ verify:auth · Verify · 执行中…
```

整个 run 收尾之后，末尾多一行：

```
  ⎿ completed · 3 个 agent
```

一个 agent 就是一行。这些子 agent 各自在自己的 session 里跑着一整段对话，那些内容
都不画在这里——三十个 agent 每个都摊开自己干的活，只会把发起它们的那段对话埋掉。

结局按工作流工具自己的用词打印，不翻译也不换成符号。只有 `completed` 是安静的，
其余一律黄色，**包括这个版本从没见过的结局**。是黄色不是红色：被取消的 agent 并没有
出错。

如果你打断了这个回合，run 会以 `没有结果` 收尾，还在跑的 agent 显示 `没有结果` 而不是
一直转。两者都不会替工作流编一个它从没报过的词。

真正意义上的 sub-agent（`@deepseek-ai/dsh-subagent`）长得不一样，原因值得知道：一次
委派把记录写进的是**子 session** 的日志，不是你这条。从这条 transcript 上看，sub-agent
就是你已经能看到的那次工具调用。而工作流工具，是会把结果报回你正在看的这条 session 的
那一个。

### 审批，以及审批之后还剩下什么

当一次工具调用需要你授权时，提示框旁边会弹出一张卡片，列出这次调用的参数：`y` 放行
一次，`n` 拒绝，`Esc` 走开。这张卡片是活的——你一答完它就没了。

留下来的是 transcript 里的一行：

```
⤷ 审批 · shell · allowed-once
⤷ 审批 · write · rejected
  writes outside the workspace
```

这件事比看上去重要。这个问题的任何内容都不会进到模型的上下文里，而卡片又活不过这个
回合；如果 transcript 不把答案记下来，那么一小时后你恢复这条 session，看到的就是一次
根本没跑的工具调用，屏幕上没有任何东西说明是你把它拦下来的。

被放行的调用是安静的。其余一律黄色——拒绝、取消、`unavailable`，以及这个版本从没见过
的任何结局。`unavailable` 值得认一下：它意味着当时压根没有人可问，那是配置问题，不是
你做的决定。是黄色不是红色：被拒绝的调用并没有出错，那正是这道闸门在干活。

如果回合结束时问题还挂在那儿，这一行会写 `没有决定`，而不是让一个问题一直悬着。

用 `/approval` 看这条 session 现在是什么策略：

```
/approval          # 当前生效的策略，以及怎么改
/approval ask      # 需要授权的调用先问你
/approval never    # 这类调用一律拒绝，不问
```

切换策略本身也会留下一行，这样一串被静默拒绝的调用才有个交代，而不是看起来莫名其妙：

```
⤷ 审批策略 · never
```

策略行永远不是黄色，`never` 也一样。更严的策略不是警告，它就是你选的设置。如果是委派
替你选的，那一行会标出来。

只有**切换**才留行。会话一开始所处的那个策略不会：那是 harness 构造会话时记下来的，
没人改动过什么，而且状态栏里的预设已经写着它是什么了。

### 权限预设

审批策略是一个旋钮，沙箱允许工具碰什么是另一个。权限预设把两者打包。输入
`/permission `（带末尾空格）会弹出选择窗口，当前生效的那个前面带 `✓`：`↑`/`↓`
选择，`Enter` 直接切换，`Tab` 只填入命令行不执行。还有一个更快的按键：**空输入框时
`Tab` / `Shift+Tab`** 在预设间前后循环（到头回绕）——切走的仍是同一条
`/permission <值>` 命令行，日志里留同样的记录。这些词也可以直接打给插件命令
`/permission <preset>`：

| 预设 | 沙箱 | 审批 |
|---|---|---|
| `read-only` | 只读，什么都不能写 | 询问 |
| `workspace-write` | 工作区可写（默认） | 询问 |
| `danger-full-access` | 全开，无沙箱 | 一律不问 |

`/permission` 由 harness 插件提供，不是 TUI 的内置命令，只要挂了插件的装配都能用；
选择器的选项读自预设 projection，没挂 projection 时选择器不出现。

当前生效的预设始终可见：StatusBar 状态行上有一个 chip，`/status` 里也有一行
`permissions:`。除了 `danger-full-access` 是**红色加粗**，其余预设都是灰色——它同时撤掉
了两道闸门，所以扫一眼边框就能确认这个 shell 还有没有防护。预设词按原文显示，不翻译。

在环境里设置 `DSH_PERMISSION_MODE=danger-full-access` 会直接以该预设启动；那个红 chip
就是确认 shell 是不是这样起来的办法。

### vim 键位

`/keybinds vim` 在输入框上加一层 normal 模式，`/keybinds default` 关掉它。不带参数的 `/keybinds` 只告诉你现在是哪一种，不会顺手切换——为了确认状态而敲的命令，不该把状态改掉。

插入模式就是你原来那个编辑器。readline 的每一个键位、`/` 命令面板、`@` 文件选择、历史回溯、粘贴，全都照旧。开 vim 只是多一层模式，不减任何东西。

`Esc` 离开插入模式。提示符会跟着变，这就是模式指示：

```
> what does this do?      ← 插入模式
N what does this do?      ← normal 模式
```

只有这一处提示，是故意的。单独画一个 `NORMAL` 标记要占一行，而整个界面是固定高度的——切换模式时多出来的一行，会直接盖在对话记录上。

能用的：

| | |
|---|---|
| 移动 | `h` `j` `k` `l` `0` `^` `$` `w` `b` `e` `gg` `G` |
| 进入插入 | `i` `a` `I` `A` `o` `O` |
| 删除 / 修改 | `x` `D` `C` `dd` `cc`，以及 `d`、`c` 接任意 motion |
| 粘贴 | `p` `P`——上一次删掉的东西 |

单词按空白切，不按标点切，所以 `~/.dsh/.env` 是一个 `w`。输入框里绝大部分内容是路径和参数，照 vim 平时那套规则，`w` 会一个字符一个字符地爬过去。

不支持的：计数（`3w`）、visual 模式、撤销。撤销是有意不做的——一个管得了 `dd` 却管不了 `Ctrl-W` 的撤销，比没有更糟。

`Esc` 仍然能中断正在跑的一轮。normal 模式下编辑器不认领它，它就照旧往上传；插入模式下第一下进 normal，第二下才中断。`/` 命令面板比这两者都优先。

这个设置会存进 `~/.dsh/tui.json`。

### 想多看几行长输出

工具结果和 `!` 命令的输出默认只预览 8 行，其余用 `… +N lines` 交代。`/verbose`
把它提到 200 行，`Ctrl-O` 是同一个开关、不用敲命令。如果不想猜不带参数会切到哪一边，
用 `/verbose on` 和 `/verbose off` 明确指定。

它一次作用于**所有**条目，而不是你指着的某一条——本应用的对话区里根本没有「当前
条目」这个概念。它不会跨 session 保存；而且如果你正滚在历史里切换它，文字会在你眼皮
底下移动，因为展开同时也在你所处位置的下方加了行。

### 接着之前的 session 干活

`/sessions` 按时间倒序列出已经存下来的 session：缩短的 id、开始时间、当时的目录，还有你在里面说的第一句话。你现在所在的这个会被标出来。

用 `/resume` 直接切过去：

```
/resume tui-9f3c1a2b   /sessions 里印出来的那个 id
/resume last           最新的那个
```

切走的那个 session 不会丢——它还在库里，`/sessions` 照样列得出来，再 `/resume` 一次就能切回去。

切过来时，已存的历史会画在屏幕上。如果你更想从新内容开始，`/history hide` 把它收起来，`/history show` 再放出来——模型读到的始终是完整日志，这只是屏幕偏好，不影响上下文。这个选择会存进 `~/.dsh/tui.json`，对下次 resume 同样生效。

缩短的 id 只要能唯一对上就够了；万一对上了两个，会直接告诉你，而不是把你丢进错的那段历史里。同样这些 id 在启动时也能用，如果你想开机就落在上次的位置：

```bash
DSH_TUI_RESUME=tui-9f3c1a2b dsh --profile tui
DSH_TUI_RESUME=last dsh --profile tui
```

### 命令与按键

所有斜杠命令，以及各自到底做什么：

| 命令 | 作用 |
| --- | --- |
| `/help` | 打印可用的斜杠命令 |
| `/clear` | 清空可见的聊天区（session log 不变） |
| `/status` | 打印当前模型、session id 和生效中的权限预设 |
| `/model` | 打印当前模型；`/model <名字>` 或 `/model <provider>/<名字>` 切换。输入 `/model `（带空格）会弹出所有已挂载 provider 的模型选择器，直接选而不必猜名字 |
| `/provider` | 列出已挂载的 LLM 提供方路由和当前生效的那个（只读；要配置得去改 llm 插件的配置） |
| `/context` | 打印上下文窗口、本次 session 的 token 开销，以及当前上下文占用了多少 |
| `/usage` | 按轮次拆开本次 session 的 token 开销 |
| `/language` | 切换界面语言：`/language en` 或 `/language zh` |
| `/mcp` | 列出已连接的 MCP 服务器，以及各自注册的工具；`/mcp add` 打开常见预设服务器的选择器、或从粘贴的 `mcpServers` 片段连一个，`/mcp remove <server>` 撤下来 |
| `/approval` | 查看这条 session 的审批策略；`/approval ask` 或 `never` 切换 |
| `/permission` | 插件命令：选择「沙箱 + 审批」打包预设——`/permission ` 打开选择器，也可直接打 `read-only` / `workspace-write` / `danger-full-access` |
| `/theme` | 选择配色假定的背景：`/theme auto`、`dark` 或 `light` |
| `/copy` | 把最新一条回复复制到剪贴板；`/copy code` 取最新的代码块 |
| `/verbose` | 让每段长输出多显示一些：`/verbose on`、`off`，不带参数则切换 |
| `/plugins` | 列出本进程加载的插件，以及各自的生命周期状态；`/plugins enable\|disable <名字>` 开关某一个，并写回 loader 配置 |
| `/sessions` | 列出已存的 session，以及接上其中一个要用的 id |
| `/skill` | 挑选可由用户调用的 skill：`/skill ` 打开选择器，`/skill <名称> [参数]` 直接运行 |
| `/resume` | 切到某个已存的 session：`/resume <id>`，或者 `/resume last` |
| `/history` | 显示或隐藏接续 session 带来的已存历史：`/history show` 或 `hide` |
| `/keybinds` | 选择输入框的键位：`/keybinds default` 或 `vim`；不带参数只报告当前是哪一种，不做切换 |
| `/exit`, `/quit` | 退出 REPL |

所有按键：

| 按键 | 作用 |
| --- | --- |
| `Enter` | 把当前输入作为用户消息发给模型——有一轮在跑时，是插话到这一轮，而不是新排一轮 |
| `Tab` | 补全 `/` 面板里高亮的那条斜杠命令 |
| `@` | 打开文件选择器；`Tab` 或 `Enter` 插入高亮的路径 |
| `Ctrl-O` | 和 `/verbose` 是同一个开关，不用敲命令 |
| `y` / `n` / `Esc` | 回答工具审批请求 —— 卡片会列出这次调用的参数，答的是它到底要干什么 |
| `Esc` | 取消正在跑的 turn 或 `!` 命令；不会退出 |
| `Ctrl-C`（turn 运行时） | 取消正在跑的 turn |
| `Ctrl-C`（输入写了一半） | 清空输入 |
| `Ctrl-C`（空闲且输入为空） | 先问一次，再按一次才等同 `/exit` |
| `Ctrl-J` | 在输入框里换行（`\` 加 `Enter` 也可以） |
| `Ctrl-P` / `Ctrl-N` | 在本次 session 输入过的内容之间前后翻 |
| `Ctrl-A` / `Ctrl-E` | 光标跳到输入的开头 / 结尾 |
| `Alt-B` / `Alt-F` | 光标左移 / 右移一个词 |
| `Ctrl-W` / `Ctrl-K` | 删掉光标前的一个词 / 删到输入结尾 |
| `↑` / `↓` | 滚动一行；输入框超过一行时改为移动光标 |
| `PageUp` / `PageDown` | 按屏滚动（保留两行重叠） |
| `Ctrl-B` / `Ctrl-F` | 同上，不用按 `Fn` |
| `Ctrl-U` / `Ctrl-D` | 滚动半屏 —— 输入框有内容时 `Ctrl-U` 删到行首 |
| `Home` / `End` | 跳到最早一行 / 回到最新 |
| `Ctrl-L` | 清屏重画（别的什么都不变） |
| 鼠标滚轮 | 支持 alternate scroll 的终端里可滚动 |

备用屏没有 scrollback，滚动完全由 TUI 自己实现。dsh 只请求终端「用方向键回答滚
轮」，而不是请求上报鼠标事件，所以**鼠标选中、复制文本一切照常**，不需要按任何修
饰键。

输入框会随内容变高，最多 10 行，超过之后在框内滚动，右侧出现滚动条——再长的消息
也不会把对话挤出屏幕。输入框高于一行时，`↑`/`↓` 归它移动光标；`PageUp`/`PageDown`
和 `Ctrl-B`/`Ctrl-F` 永远滚动对话。

## 已知限制

- **`@` 只补全路径，不会把文件塞进消息。** 输入 `@src/pro` 再按 `Tab`，写进消息的是 `@src/prompt/prompt-layout.ts` 这段文字，文件内容不会被读取或内联。往 prompt 里放什么是 harness 的决定，不该由一个输入框替它做——何况模型自己就有文件工具，拿到路径就能打开。
- **切 session 得先结束当前这一轮。** 有一轮在跑的时候所有斜杠命令都会被拒绝，`/resume` 也一样，先按 Esc 取消。也没法同时开着两个 session。
- **长工具输出只给预览，展不开。** 会显示前 8 行，末尾加一条 `… 还有 N 行` 的标记；没有展开入口——要做展开就得引入这个应用刻意不要的选中模型。
- **`ctx.appExit` 由 launcher 提供。** 在 `dsh` CLI 外面跑会大声报错，直到 host 提供 exit hook。

