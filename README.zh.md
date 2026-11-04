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

要求：Node ≥ 22.19、一个真 TTY（iTerm / Terminal.app / Windows Terminal + PowerShell 7；老 conhost 的 `cmd.exe` 不行）、一个 DeepSeek API key。

本包在 npm 上的名字是 **`@qiao-qyn/dsh-tui`**（**不在** `@deepseek-ai` scope 下）。它是 `dsh` 的一个 bundle，所以流程是：先把 launcher 装上，再把 bundle 挂进一个 profile。

从本分支运行 `pnpm install --frozen-lockfile && pnpm run build && npm pack` 生成安装包，将下文路径替换成它的绝对路径。

```sh
# 1. launcher（每台机器一次）
npm install -g @deepseek-ai/dsh@0.2.1-rc.5

# 2. 为 rc.5 新建独立 profile
mkdir -p ~/.dsh/profiles/tui-rc5 && cd ~/.dsh/profiles/tui-rc5
npm init -y
npm install --save-exact @deepseek-ai/dsh-base@0.2.1-rc.5 /absolute/path/to/qiao-qyn-dsh-tui-0.2.1-rc.5.tgz
npm pkg set 'dsh.profile.bundles[0]=@deepseek-ai/dsh-base' 'dsh.profile.bundles[1]=@qiao-qyn/dsh-tui'

# 3. 在 ~/.dsh/.env 中设置 DEEPSEEK_API_KEY，然后启动
dsh --profile tui-rc5
```

**Windows（PowerShell 7 + Windows Terminal）：**

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

> 如果 npm 报告依赖的构建脚本被阻止，可用 `npm install-scripts ls` 查看清单。使用 pnpm 时，可用 `pnpm approve-builds` 处理 profile 所需的原生依赖。Windows 上如果依赖树触发 `ENAMETOOLONG`，把 profile 装到
> 离盘符根更近的位置（比如 `C:\tui`），或者把
> `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem` 的 `LongPathsEnabled` 设为 `1`。

设置 `DSH_HOME` 可以将会话、配置和 TUI 偏好保存在独立目录。rc.5 下的 `!cd` 会切换当前会话的工作目录。

## 用起来

打一句话，**Enter** 发送；**Esc** 取消正在跑的这一轮；**`/exit`** 退出。

| | |
| --- | --- |
| `/changes` | 查看最近任务或 `/changes N` 的文件、增删行和命令结果总览 |
| `/queue` | 查看待执行输入；`add <文字>`、`edit <id> <文字>`、`remove <id>`、`clear` 管理后续独立任务 |
| `/notify` | `off` / `bell` / `desktop`；`/notify test` 测试提醒，默认关闭 |
| `/mouse` | `auto` / `on` / `off`；F2 切换鼠标上报与原生文字选择 |
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
| `/context` / `/usage` | 上下文窗口，以及本次 session 的 token 开销 |
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
- **[docs/DEVELOP.md](docs/DEVELOP.md)** —— 改源码：link 模式 profile、编辑 / 重建 / 重启循环、项目结构、发版流程。
- **[docs/SPEC.md](docs/SPEC.md)** —— 设计契约：视觉规则、路线图、贡献者约定。

Apple Terminal 在 `/mouse auto` 下使用鼠标上报传递滚轮。F2 或 `/mouse off` 恢复原生文字选择，`/mouse on` 恢复上报；如果终端配置禁用了鼠标上报，请启用 Terminal.app 的 Allow Mouse Reporting。其他终端在 auto 下沿用备用屏幕滚轮输入。任务结束后保留事件计算的耗时并收起中间过程，最终答复和失败信息保持可见。

后台诊断写入 `DSH_HOME` 下的 `tui.log`（默认 `~/.dsh/tui.log`）。开启鼠标上报后可点击任务摘要展开，F2 可恢复原生文字选择。

人工验收：[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

草稿按会话自动保存到 `DSH_HOME/tui-drafts`，接续同一会话时恢复；提交后清除对应草稿。

## License

MIT

### 剪贴板图片

按 **Ctrl-V** 将截图加入附件预览；普通终端文本粘贴保持原样，Cmd-V 无法直接把图片字节交给终端。macOS 使用原生剪贴板，Windows 使用 Windows PowerShell/WinForms，Linux 需安装 `wl-paste`（Wayland）或 `xclip`（X11）。读取的是运行 dsh 的那台机器的剪贴板，SSH 连接时也是远端。环境不支持时会提示，仍可粘贴图片路径。

图片私密保存在 `DSH_HOME/tui-clipboard`，按内容去重；单张上限 16 MiB，缓存上限 64 个文件 / 256 MiB。Ctrl-X 移除草稿附件，Ctrl-Z 撤销插入；缓存会保留以支持草稿恢复和撤销，手动清理前请保留草稿引用的图片。发送时仍检查附件服务和模型图片能力。

### 外部草稿编辑器

空闲时按 **Ctrl-T**，使用 `$VISUAL`、其次 `$EDITOR` 编辑当前草稿；未配置时使用 `vi`（Windows 使用 `notepad.exe`）。支持带引号的程序路径和参数，不执行 shell 展开。GUI 编辑器需使用等待参数，例如 `code --wait`。保存退出后返回输入框，不会自动发送，Ctrl-Z 可一次撤销整个外部编辑；非零退出或读取失败时保留原草稿。返回内容需为 UTF-8，最多 2 MiB。临时文件私密保存，在编辑器退出后删除；交接前立即保存草稿，返回时恢复输入、终端屏幕、鼠标模式和画面。
