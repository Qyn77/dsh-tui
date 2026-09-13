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
│  tui-01e62198 · v0.1.0-rc.8       deepseek-official/deepseek-v4-flash   │
│  ~/Desktop/dsh-tui (main*)           Tip: /help · /status · Tab completes │
╰──────────────────────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────────────────────────────╮
│ > 问 dsh 任何事…                                                         │
╰──────────────────────────────────────────────────────────────────────────╯
```

## 安装

要求：Node ≥ 22.19、一个真 TTY（iTerm / Terminal.app / Windows Terminal + PowerShell 7；老 conhost 的 `cmd.exe` 不行）、一个 DeepSeek API key。

本包在 npm 上的名字是 **`@qiao-qyn/dsh-tui`**（**不在** `@deepseek-ai` scope 下）。它是 `dsh` 的一个 bundle，所以流程是：先把 launcher 装上，再把 bundle 挂进一个 profile。

```sh
# 1. launcher（每台机器一次）
npm install -g @deepseek-ai/dsh

# 2. 建一个挂上本 bundle 的 profile
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
npm init -y
# @next 把 dsh-base 钉到和本 bundle 同一代的 0.1.0-rc.x；
# latest 标签目前还指向已弃用的 0.0.1-rc.1。
npm install @deepseek-ai/dsh-base@next @qiao-qyn/dsh-tui
echo '[]' > cordis.yml

# 3. 注册 bundle。`npm install` 只填了 node_modules；launcher 读的是
#    package.json#dsh.profile.bundles，这一步才把它写进去。
dsh plugin --profile tui install

# 4. 一次性写 key。dsh 每次启动都会读 ~/.dsh/.env，之后不用再 export。
echo 'DEEPSEEK_API_KEY=sk-...' > ~/.dsh/.env
chmod 600 ~/.dsh/.env

# 5. 启动
dsh --profile tui
```

**Windows（PowerShell 7 + Windows Terminal）：**

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

> 想用 pnpm 也行：同样的步骤换成 `pnpm add`，另外要跑一次 `pnpm approve-builds`
> （勾选 `node-pty`、`koffi`、`protobufjs`、`dsh-subprocess-local`）—— npm 默认
> 就执行这些 build 脚本。Windows 上如果依赖树触发 `ENAMETOOLONG`，把 profile 装到
> 离盘符根更近的位置（比如 `C:\tui`），或者把
> `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem` 的 `LongPathsEnabled` 设为 `1`。

## 用起来

打一句话，**Enter** 发送；**Esc** 取消正在跑的这一轮；**`/exit`** 退出。

| | |
| --- | --- |
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
| `/copy` | 把最新回复放进剪贴板；`/copy code` 取最新代码块 |
| `/verbose` | 长输出多看几行（`Ctrl-O` 是同一个开关） |
| `/keybinds` | 输入框键位：`default` 或 `vim` |
| `/provider`、`/plugins` | 已挂载的 LLM 路由；已加载的插件 |
| `/sessions`、`/resume` | 列出已存 session；`/resume <id>` 或 `/resume last` |
| `/history` | 显示或隐藏接续 session 带来的已存历史 |
| `!`、`!!` | 跑一条系统命令 —— `!!` 还会把它给模型看 |
| `/exit`, `/quit` | 退出 REPL |
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

## License

MIT
