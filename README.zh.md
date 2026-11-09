# `@qiao-qyn/dsh-tui`

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Claude Code 风格终端 UI。一个 Cordis bundle（`tui-runner`），骑在 `dsh-base` 之上，把默认的 Web UI 替换成全屏 Ink REPL —— 同一个 Agent、同样的工具、同样的模型，只是搬到了终端里。

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
│ > 问 dsh 任何事…                                                         │
╰──────────────────────────────────────────────────────────────────────────╯
```

## 安装

推荐使用一键安装器：自动检查环境、拉取源码、构建、安装匹配的
`dsh` / `dsh-base` / TUI，并在校验成功后激活独立 profile。
需要 **Node ≥ 22.19（含 npm）、Git**；Windows 安装可用 CMD（`install.cmd`）或 PowerShell 7（`install.ps1`），运行 TUI 使用 PowerShell 7 + Windows Terminal。

```sh
# 已有源码，无需先手动安装 pnpm 或 build
node scripts/install.mjs
```

macOS / Linux 可直接运行：

```sh
curl -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/install.sh | bash
```

Windows PowerShell 7（使用 `curl.exe`，避免 `curl` 别名差异）：

```powershell
curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o "$env:TEMP\dsh-tui-install.mjs" && node "$env:TEMP\dsh-tui-install.mjs"
```

Windows CMD：

```bat
curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o "%TEMP%\dsh-tui-install.mjs" && node "%TEMP%\dsh-tui-install.mjs"
```

Windows 一键命令、参数、API Key 配置和故障恢复见 **[安装指南](docs/INSTALL.md)**。
安装前检查工具、磁盘空间、目录写权限和依赖源连接，不满足条件就停止并提示。
安装成功后自动配置用户级 `dsh-tui` 命令和 PATH；**新开终端后输入 `dsh-tui` 即可启动**
（Windows 需完全退出并重新打开 Windows Terminal）。用 `--check` 只检查环境，
或用 `--no-path` 不修改 shell/PATH，按输出的 `node .../launch.mjs` 手动启动。
两种启动方式都固定使用 profile 内的
运行时，避免全局 `dsh` 版本冲突。现有配置、凭据和会话保留，已有非托管 profile
不会被覆盖。更新前先退出 TUI。

脚本不会自动安装系统前置工具；无需先装桌面版或全局 `dsh`/pnpm。
开始对话前还需有效 API Key 或账号凭据，见 [API Key 配置](docs/INSTALL.md#api-key--配置-api-key)。
与桌面版使用相同 `DSH_HOME` 时可共享凭据，但不会自动导入桌面版的模型、插件配置，
也不复用其私有 Node，具体见 [桌面版共享范围](docs/INSTALL.md#harness-desktop--与桌面版一起使用)。

> npm 上当前只有旧的 TUI 0.1.0 预发布包（2026-11-09 核对），不能用它搭配
> `dsh-base@0.2.1-rc.5`。安装器会按源码锁文件构建当前版本。

## 用起来

打一句话，**Enter** 发送；**Esc** 取消正在跑的这一轮；**`/exit`** 退出。

| | |
| --- | --- |
| `/changes` | 查看最近任务或 `/changes N` 的文件、增删行和命令结果总览 |
| `/queue` | 查看待执行输入；`add <文字>`、`edit <id> <文字>`、`remove <id>`、`clear` 管理后续独立任务 |
| `/notify` | `off` / `bell` / `desktop`；`/notify test` 测试提醒，默认关闭 |
| `/mouse` | `auto` / `on` / `off`；F2 切换鼠标上报与原生文字选择 |
| `/checkpoint [list / save <path> / seal <id> / show <id> / restore <id> [confirm]]` | 保存单个文件的修改前状态，封存预期修改；预览后，仅当文件未再次改动时恢复。见[检查点设计](docs/FILE-CHECKPOINTS.md)。 |
| `/tabs [new / next / prev / close / <id>]` | 顺序会话标签：new / next / prev / close，或选择访问过的会话。仅空闲时切换，关闭保留历史；不在后台并行执行。 |
| `/terminal` | 查看适配器、运行环境、请求的模式与收到过的事件 |
| `/activity` | 展开/收起任务过程：`/activity <编号>`、`all`、`none` |
| `/search` / `/jump` | 搜索完整内容；按编号定位，或用 `next`、`prev`、`user`、`tool`、`error` 导航 |
| `/inspect` | 按编号查看完整条目，Esc 返回对话 |
| `/export` | 导出 Markdown：`/export <路径> [--entry=N]`，已有文件会保留 |
| `/resume ` / `/sessions ` | 按标题、目录或 ID 搜索历史会话，Enter 接续所选会话 |
| `/diff` | 查看已记录的文件修改，`/diff N` 只看指定条目 |
| `/retry` | 查看失败情况；`continue` 根据已有结果继续，`draft` 恢复请求文本 |
| `/branch` | 从当前对话或指定轮次创建会话分支：`/branch N` |
| `/help` | 列出所有斜杠命令 |
| `/status` | 当前模型、session id、生效中的权限预设 |
| `/model` | 显示当前模型；`/model <名字>` 切换，`/model ` 打开选择器 |
| `/clear` | 清空可见对话区（session log 不变） |
| `/context` / `/usage` | 上下文与 token 开销；`/context view [N\|tools]` 查看有效记录，`/context request [N\|tools]` 查看最近捕获的请求 |
| `/mcp` | 已连接的 MCP 服务器；`/mcp add`、`/mcp remove <server>` |
| `/permission` | 选择「沙箱 + 审批」打包预设 |
| `/approval` | 查看或切换审批策略（`ask` / `never`） |
| `/skill` | 挑选并运行一个可调用的 skill |
| `/language`、`/theme` | `en` / `zh`；`auto` / `dark` / `light` |
| `/copy` | 复制最新回复；`/copy code` 复制代码块；`/copy N` 复制指定条目 |
| `/verbose` | 长输出多看几行（`Ctrl-O` 是同一个开关） |
| `/keybinds` | 输入框键位：`default` 或 `vim` |
| `/provider`、`/plugins` | 已挂载的 LLM 路由；已加载的插件 |
| `/sessions` | 列出会话；`all` / `archived` 筛选；`rename <id\|current> <标题>` 命名；`favorite` / `archive <id\|current> on|off` 整理 |
| `/resume` | 按 ID 或 `last` 接续；Ctrl-G 打开选择器并保留草稿 |
| `/history` | 显示或隐藏接续 session 带来的已存历史 |
| `!`、`!!` | 跑一条系统命令 —— `!!` 还会把它给模型看 |
| `/exit`, `/quit` | 退出 REPL |
| `Ctrl-Z` / `Ctrl-Y`、`Ctrl-R` | 撤销 / 重做输入；Vim normal 模式的 `u` 也可撤销 |
| `Ctrl-T` | 空闲时用 VISUAL / EDITOR 编辑草稿，保存退出后返回 |
| `Ctrl-V` / 终端转发的 `Meta-V` | 将剪贴板图片加入附件预览 |
| `Ctrl-G` | 保留当前草稿并打开会话选择器；Esc 返回 |
| `Ctrl-X` | 发送前显示图片名称、数量和大小；移除光标处或最后一张图片 |
| `Tab` | 补全高亮的 `/` 命令或 `@` 路径 |
| `@` | 打开文件选择器 |
| `↑` / `↓`、`PageUp` / `PageDown`、`Ctrl-L` | 滚动对话 / 清屏重画 |
| `Ctrl-C` | 取消这一轮、清空输入、或退出（会先问一次） |

每个命令、按键和功能的完整说明 —— `!` 系统命令、MCP 服务器、图片、skill、hook、
审批、session 接续、已知限制：**[docs/USAGE.md](docs/USAGE.md)**。

## 更多文档

- **[项目主页](https://qyn77.github.io/dsh-tui/)** —— 长什么样、能做什么、三步装好（中英双语）。
- **[docs/USAGE.md](docs/USAGE.md)** —— 各功能详细说明，以及完整的命令与按键速查表。
- **[docs/DEVELOP.md](docs/DEVELOP.md)** —— 改源码：安装包开发 profile、编辑 / 重建 / 重装 / 重启循环、项目结构、发版流程。
- **[docs/SPEC.md](docs/SPEC.md)** —— 设计契约：视觉规则、路线图、贡献者约定。
- **[docs/OCR-CI.md](https://github.com/Qyn77/dsh-tui/blob/ci/ocr-review/docs/OCR-CI.md)** —— 配置 GitHub Actions 的 PR 代码评审及所需凭据。

终端差异统一由适配器处理。Apple Terminal、VS Code、iTerm2、Windows Terminal、VTE、Konsole、Kitty、Ghostty、WezTerm、Alacritty、Warp 在直接连接且被识别时，`/mouse auto` 请求鼠标上报；未知终端和 tmux/screen 默认使用备用滚动模式。F2 或 `/mouse off` 恢复原生文字选择，`/mouse on` 显式请求鼠标上报；Terminal.app 仍需启用 Allow Mouse Reporting。`/activity` 始终可用作无鼠标展开入口。识别基于环境证据，不等于实际能力验证；用 `/terminal` 查看详情，用 `DSH_TUI_TERMINAL` 覆盖可能被继承的终端标识。

后台诊断写入 `DSH_HOME` 下的 `tui.log`（默认 `~/.dsh/tui.log`）。开启鼠标上报后可点击任务摘要展开，F2 可恢复原生文字选择。

人工验收：[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

草稿按会话自动保存到 `DSH_HOME/tui-drafts`，接续同一会话时恢复；提交后清除对应草稿。

## License

MIT

### 剪贴板图片

按 **Ctrl-V** 导入剪贴板截图，前提是终端把该按键传给程序。Apple Terminal / VS Code 适配器也识别实际收到的 `Meta-V`，以及空 bracketed paste 后确实能读到图片的兼容路径；这不代表 Command-V 一定会发送这些信号。普通 Command-V 由终端应用接管，若没有传入字节，TUI 无法拦截；可尝试 Terminal.app 的 **Control-Command-V**，也可粘贴图片文件路径。普通文本粘贴保持不变。macOS 使用原生剪贴板，Windows 使用 PowerShell/WinForms，Linux 需 `wl-paste`（Wayland）或 `xclip`（X11）。SSH 默认不读取主机图片剪贴板，显式设置 `DSH_TUI_REMOTE_CLIPBOARD=host` 才读取远端，无法读取客户端图片；WSL 使用 Windows 剪贴板需 `DSH_TUI_WSL_CLIPBOARD=windows` 并启用互操作。图片只显示为附件，缓存路径不进入输入正文。

图片私密保存在 `DSH_HOME/tui-clipboard`，按内容去重；单张上限 16 MiB，缓存上限 64 个文件 / 256 MiB。Ctrl-X 移除草稿附件，Ctrl-Z 撤销插入；缓存会保留以支持草稿恢复和撤销，手动清理前请保留草稿引用的图片。发送时仍检查附件服务和模型图片能力。

### 外部草稿编辑器

空闲时按 **Ctrl-T**，使用 `$VISUAL`、其次 `$EDITOR` 编辑当前草稿；未配置时使用 `vi`（Windows 使用 `notepad.exe`）。支持带引号的程序路径和参数，不执行 shell 展开。GUI 编辑器需使用等待参数，例如 `code --wait`。保存退出后返回输入框，不会自动发送，Ctrl-Z 可一次撤销整个外部编辑；非零退出或读取失败时保留原草稿。返回内容需为 UTF-8，最多 2 MiB。临时文件私密保存，在编辑器退出后删除；交接前立即保存草稿，返回时恢复输入、终端屏幕、鼠标模式和画面。

### 只读上下文查看

`/context view` 列出当前有效的系统指令、对话、注入上下文、附件与压缩后记录，直接读取 `Session.deriveMessages()`，不会重新组装提示词或修改模型上下文。草稿和待处理队列不包含在内，并单独说明。显示的路由和工具来自最近记录的请求头，可能与等待下一轮生效的模型选择不同。

`/context request` 查看本进程对此会话最近捕获的模型请求，处于供应商协议转换之前；不会混入之后的回复或标题、压缩等辅助调用，也不表示网络已送达。重启后需等新请求才有此快照。在任一命令后加条目编号可查看完整可用内容，加 `tools` 可查看工具定义；支持正常滚动，Esc 返回。附件只显示引用信息，不读取图片字节，供应商内部重放元数据不展示。

终端行为通过统一适配器服务组合；实现与验收计划见[终端适配器](docs/TERMINAL-ADAPTERS.md)。SSH 图片剪贴板读取需显式设置 `DSH_TUI_REMOTE_CLIPBOARD=host`，读取远端主机而不是 SSH 客户端；WSL 访问 Windows 剪贴板需设置 `DSH_TUI_WSL_CLIPBOARD=windows`。

macOS Terminal.app 图片粘贴采用 **Ctrl-V**。本项目不安装需要系统权限的 Command-V 桥接，也不把 Terminal.app 的 Command-V 图片粘贴标为已支持。读取图片时可以继续打字；完成后再发送，Ctrl-C 可取消这次导入。

### 分级命令选择

选择命令后按 Enter，继续选择已知参数。设置标记当前值；任务和消息显示摘要，
不用记编号。会话整理、队列、MCP、插件、提供方模型和上下文记录也支持逐级选择。
↑/↓ 选择，Enter 确定，Tab 只填入不执行，Esc 清除筛选、返回上一级，再关闭菜单。
输入文字可以筛选选项；Ctrl-G 仍保留原来的快速接续和草稿恢复行为。

搜索词、新标题、队列正文、自定义 MCP 配置和保存路径继续手动输入。
例如 `/export` → 选择消息后会填入 `/export --entry=N `，只需输入保存路径再回车。
原有完整命令仍可使用；需要手写语法时按 Esc 关闭菜单。Terminal.app 图片导入仍用 Control-V。

对话浏览：**F3** 打开交互搜索（也可 `/search <关键词>`），**F4** 先选消息，
再选择跳转、完整查看、复制、记录的变更或 Markdown 导出。方向键选择，Enter
打开，Esc 返回；输入草稿保留。导出需填写新文件路径。`/terminal` 可查看实际
加载的构建提交号、未提交标记、模块路径和 SHA-256 指纹。

**F5** 管理待发送图片：方向键选择，Enter 本机预览，Delete 移除选中的图片，
关闭后 Ctrl-Z 可撤销移除。本机预览支持 macOS Preview 和 Linux xdg-open；
远程、WSL、复用器连接不尝试调用本机查看器。
