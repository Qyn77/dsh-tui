# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Claude Code 风格终端 UI。一个 Cordis bundle（`tui-runner`），骑在 `dsh-base` 之上，把默认的 Web UI 替换成全屏 Ink REPL。同一个 Agent、同样的工具、同样的模型 —— 换到终端里。

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
│ > 问 dsh 任何事…                                                         │
╰──────────────────────────────────────────────────────────────────────────╯
```

TUI 使用终端的备用屏幕缓冲区，行为类似 `vim` 或 `htop`。启动 Banner、
消息、状态栏和输入框会在 resize 稳定后作为一个完整画面重绘；退出 REPL
后恢复原来的 shell 屏幕和 scrollback。Banner 根据宽度分为三档：宽屏的
鲸鱼/字标、中文档字标，以及窄屏的紧凑纯文本档。

## 用起来

> macOS / Linux / Windows。需要 Node ≥ 22.19、pnpm ≥ 9、一个真 TTY
> （Windows Terminal + PowerShell 7、iTerm/Terminal.app、或任何支持
> ANSI 的 TTY；老 conhost 跑 cmd.exe 不行）、一个 DeepSeek API key。

**macOS / Linux（bash、zsh、Git Bash、WSL）：**

```sh
# 1. 装 dsh CLI（一次）
npm install -g @deepseek-ai/dsh

# 2. 建 profile
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
pnpm init
# @next 把 dsh-base 钉到跟本包同一代的 0.1.0-rc.x；latest 标签目前指向
# 已弃用的 0.0.1-rc.1，它有个传递依赖从来没发到 npm。
pnpm add @deepseek-ai/dsh-base@next @deepseek-ai/dsh-tui
echo '[]' > cordis.yml

# 3. 注册 bundle。pnpm add 只是把它们装到 node_modules；dsh launcher
#    实际读的是 package.json 里的 `dsh.profile.bundles`。`dsh plugin install`
#    会按已装的依赖把这个字段补齐。
dsh plugin --profile tui install

# 4. 一次性批准原生模块的 build 脚本
#    sandbox 和 shell 这些能力都依赖这些二进制。
pnpm approve-builds    # 勾选：node-pty, koffi, protobufjs, dsh-subprocess-local

# 5. 一次性设置 API key。dsh 每次启动会读 `~/.dsh/.env`，之后就不用再
#    `export` 了。要换 key 直接编辑这个文件。
cat > ~/.dsh/.env <<'EOF'
DEEPSEEK_API_KEY=sk-...
EOF
chmod 600 ~/.dsh/.env

# 6. 启动
dsh --profile tui
```

**Windows（PowerShell 7 + Windows Terminal）：**

```powershell
# 1. 装 dsh CLI（一次）
npm install -g @deepseek-ai/dsh

# 2. 建 profile
$profilePath = Join-Path $env:USERPROFILE ".dsh\profiles\tui"
New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
Push-Location $profilePath
pnpm init
# @next 的原因同上面 macOS / Linux 段。
pnpm add @deepseek-ai/dsh-base@next @deepseek-ai/dsh-tui
Set-Content -Path cordis.yml -Value "[]"

# 3. 注册 bundle（跟 macOS/Linux 同一份 `dsh.profile.bundles` 合约）
dsh plugin --profile tui install

# 4. 一次性批准原生 build 脚本。node-pty 和 koffi 走 prebuild-install
#    拉 Windows 预编译产物；不装 MSVC 也能用，只有 fallback 到源码编译才需要。
pnpm approve-builds    # 勾选：node-pty, koffi, protobufjs, dsh-subprocess-local

# 5. 一次性设置 API key。dsh 每次启动会读
#    `$env:USERPROFILE\.dsh\.env`，之后就不用再设
#    `$env:DEEPSEEK_API_KEY` 了。要换 key 直接编辑这个文件。
Set-Content -Path "$env:USERPROFILE\.dsh\.env" -Value "DEEPSEEK_API_KEY=sk-..."

# 6. 启动
dsh --profile tui
Pop-Location
```

> **Windows 长路径。** DeepSeek Harness 的依赖树很深；如果遇到
> `ENAMETOOLONG`，要么把 profile 装到离盘符根近一点的目录（比如
> `C:\tui`），要么打开 Win32 长路径支持（改完要重启）：
>
> ```powershell
> Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1
> ```

REPL 里：输入消息按 **Enter** 发送；**Ctrl-C** 取消当前 turn；**`/exit`** 退出。

| 命令 | 作用 |
| --- | --- |
| `Enter` | 把当前输入作为用户消息发给模型 |
| `/help` | 打印可用的斜杠命令 |
| `/clear` | 清空可见的聊天区（session log 不变） |
| `/status` | 打印当前模型和 session id |
| `/model` | 打印当前模型；`/model <名字>` 或 `/model <provider>/<名字>` 切换 |
| `/context` | 打印上下文窗口、本次 session 的 token 开销，以及当前上下文占用了多少 |
| `/usage` | 按轮次拆开本次 session 的 token 开销 |
| `/language` | 切换界面语言：`/language en` 或 `/language zh` |
| `/theme` | 选择配色假定的背景：`/theme auto`、`dark` 或 `light` |
| `/copy` | 把最新一条回复复制到剪贴板；`/copy code` 取最新的代码块 |
| `/verbose` | 让每段长输出多显示一些：`/verbose on`、`off`，不带参数则切换 |
| `/plugins` | 列出本进程加载的插件，以及各自的生命周期状态；`/plugins enable\|disable <名字>` 开关某一个，并写回 loader 配置 |
| `/exit`, `/quit` | 退出 REPL |
| `Tab` | 补全 `/` 面板里高亮的那条斜杠命令 |
| `@` | 打开文件选择器；`Tab` 或 `Enter` 插入高亮的路径 |
| `Ctrl-O` | 和 `/verbose` 是同一个开关，不用敲命令 |
| `y` / `n` / `Esc` | 回答工具审批请求 |
| `Ctrl-C`（空闲时） | 等同 `/exit` |
| `Ctrl-C`（turn 运行时） | 取消正在跑的 turn |
| `Ctrl-J` | 在输入框里换行（`\` 加 `Enter` 也可以）|
| `Ctrl-P` / `Ctrl-N` | 在本次 session 输入过的内容之间前后翻 |
| `Ctrl-A` / `Ctrl-E` | 光标跳到输入的开头 / 结尾 |
| `Alt-B` / `Alt-F` | 光标左移 / 右移一个词 |
| `Ctrl-W` / `Ctrl-K` | 删掉光标前的一个词 / 删到输入结尾 |
| `↑` / `↓` | 滚动一行；输入框超过一行时改为移动光标 |
| `PageUp` / `PageDown` | 按屏滚动（保留两行重叠） |
| `Ctrl-B` / `Ctrl-F` | 同上，不用按 `Fn` |
| `Ctrl-U` / `Ctrl-D` | 滚动半屏 |
| `Home` / `End` | 跳到最早一行 / 回到最新 |
| `Ctrl-L` | 清屏重画（别的什么都不变）|
| 鼠标滚轮 | 支持 alternate scroll 的终端里可滚动 |

备用屏没有 scrollback，滚动完全由 TUI 自己实现。dsh 只请求终端「用方向键回答滚
轮」，而不是请求上报鼠标事件，所以**鼠标选中、复制文本一切照常**，不需要按任何修
饰键。

输入框会随内容变高，最多 10 行，超过之后在框内滚动，右侧出现滚动条——再长的消息
也不会把对话挤出屏幕。输入框高于一行时，`↑`/`↓` 归它移动光标；`PageUp`/`PageDown`
和 `Ctrl-B`/`Ctrl-F` 永远滚动对话。

要求：Node ≥ 22.19、pnpm ≥ 9、真正的终端（Ink 需要 TTY）、一个 DeepSeek API key。

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

### 想多看几行长输出

工具结果和 `!` 命令的输出默认只预览 8 行，其余用 `… +N lines` 交代。`/verbose`
把它提到 200 行，`Ctrl-O` 是同一个开关、不用敲命令。如果不想猜不带参数会切到哪一边，
用 `/verbose on` 和 `/verbose off` 明确指定。

它一次作用于**所有**条目，而不是你指着的某一条——本应用的对话区里根本没有「当前
条目」这个概念。它不会跨 session 保存；而且如果你正滚在历史里切换它，文字会在你眼皮
底下移动，因为展开同时也在你所处位置的下方加了行。

## 改起来

**macOS / Linux（bash、zsh、Git Bash、WSL）：**

```sh
# 1. 拉源码
git clone https://github.com/<your-fork>/dsh-tui.git
cd dsh-tui

# 2. 装依赖（构建工具 + 从 npm 拉的 harness peer）
pnpm install
pnpm approve-builds esbuild    # 一次性，允许 tsdown 的 bundler 跑 postinstall

# 3. 自检 + 首次 build
pnpm run typecheck
pnpm test                      # 20 个单元测试，约 500ms
pnpm run build                 # tsc 产 .d.ts，tsdown 产 lib/index.js

# 4. 建一个指向本 checkout 的 link profile
mkdir -p ~/.dsh/profiles/tui-dev && cd ~/.dsh/profiles/tui-dev
pnpm init
# @next 的原因同「用起来」那段。
pnpm add @deepseek-ai/dsh-base@next @deepseek-ai/dsh-tui@link:/absolute/path/to/dsh-tui
echo '[]' > cordis.yml

# 5. 注册 bundle + 批准原生 build
dsh plugin --profile tui-dev install
pnpm approve-builds            # 勾选：node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. 一次性设置 API key（如果「用起来」段已经做过，跳过）。
cat > ~/.dsh/.env <<'EOF'
DEEPSEEK_API_KEY=sk-...
EOF
chmod 600 ~/.dsh/.env

# 7. 启动
dsh --profile tui-dev
```

**Windows（PowerShell 7 + Windows Terminal）：**

```powershell
# 1. 拉源码
git clone https://github.com/<your-fork>/dsh-tui.git
cd dsh-tui

# 2. 装依赖
pnpm install
pnpm approve-builds esbuild

# 3. 自检 + 首次 build
pnpm run typecheck
pnpm test
pnpm run build

# 4. 建一个 link profile。@link: 路径用正斜杠。
$devProfile = Join-Path $env:USERPROFILE ".dsh\profiles\tui-dev"
New-Item -ItemType Directory -Force -Path $devProfile | Out-Null
Push-Location $devProfile
pnpm init
pnpm add @deepseek-ai/dsh-base@next "@deepseek-ai/dsh-tui@link:$PWD/../dsh-tui"
# $PWD 假设你把仓库 clone 在 .dsh 同级目录。如果不是，把绝对路径写出来：
# "@deepseek-ai/dsh-tui@link:C:/Users/you/Desktop/dsh-tui"
Set-Content -Path cordis.yml -Value "[]"

# 5. 注册 bundle + 批准原生 build
dsh plugin --profile tui-dev install
pnpm approve-builds            # 勾选：node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. 一次性设置 API key（如果「用起来」段已经做过，跳过）。
Set-Content -Path "$env:USERPROFILE\.dsh\.env" -Value "DEEPSEEK_API_KEY=sk-..."

# 7. 启动
dsh --profile tui-dev
Pop-Location
```

> 第 3 步的 build 在**首次启动前必须做**（各平台都一致）。link 进来的
> `dsh-tui` 包导出的是 `lib/index.js`，不是 `src/index.ts`，launcher
> 原样读它。`pnpm run build` 生成它 —— 没这步的话 loader 会落到
> `lib/` 里残留的旧文件。

### 编辑 / 重建 / 重启 的循环

改完 `src/` 下的文件，loader 看不到 —— 要重建 + 重启：

```sh
# 在本仓库里
pnpm run build          # 约 30ms
# 在另一个终端
Ctrl-C                  # 关掉正在跑的 dsh
dsh --profile tui-dev   # 重启，加载新的 lib/index.js
```

`pnpm test` 和 `pnpm run typecheck` 直接跑 `.ts` 源码，不用 build。

### `pnpm tty-check`

测试全程没有 TTY、颜色等级被钉死在 0，所以有三个已发布的特性只能被当成算术来验证：
OSC 11 背景探测、OSC 52 剪贴板写入，以及由这两者选出的颜色在你真实背景上是否看得清。

```sh
pnpm tty-check          # 在你日常用的终端里跑
```

它直接 import 真实模块——不另抄一份转义序列——把你的终端回了什么打出来，
并且四项检查里有两项以提问收尾：「这段看得清吗」和「剪贴板里真的收到了吗」
不是程序能自己看见的事。任何一个你回答「否」的地方，都是测试套件抓不到的真 bug。

### 项目结构

```
src/
├── index.ts                 Cordis 插件入口：建 Agent，render <App/>
├── renderer.tsx             Ink 根组件
├── state.ts                 纯 reducer：SessionEvent → UiState
├── types.ts                 UiEntry、UiState、isRenderable、declaration-merged 事件表
├── commands.ts              /help /clear /status /language /plugins /exit /quit 派发
├── i18n.ts                  纯双语文案表（英文 + 中文）
├── shell.ts                 纯逻辑：`!` 解析、`cd` 规则、输出截断
├── shell-runner.ts          唯一的 spawn 处：执行一条 `!` 命令
├── settings.ts              读写 ~/.dsh/tui.json（语言选择）
├── invariant.ts             空的 package-invariant companion
├── scroll.ts                纯滚动算术 + 按键/鼠标解析
├── prompt-layout.ts         纯输入折行、光标、可视窗口、滚动条
├── message-layout.ts        纯字形栏字符、工具调用与结果摘要
├── width.ts                 纯显示宽度（CJK 占两列）
├── resize.ts                真实 TTY 的 resize 唯一负责方——防抖、清屏、重渲染、强制重绘
├── hooks/
│   ├── useSessionEvents.ts  回放 log + 订阅 session/event
│   ├── useMessageListScroll.ts  滚动偏移、按键绑定、实测几何
│   ├── useResizeRepaint.ts  非 TTY resize 回归测试辅助
│   ├── useShell.ts          执行 `!`；全包唯一调用 process.chdir 的地方
│   └── useStrings.tsx       当前语言，用 React context 传递
└── components/
    ├── StatusBar.tsx        顶部：模型 · session · 状态 · token
    ├── MessageList.tsx      中部：字形栏对话视口
    └── Prompt.tsx           底部：自动增高的输入框，最多 10 行

tests/                       state、commands、apply() 的 vitest 单元测试
```

| 配置文件 | 作用 |
| --- | --- |
| `tsconfig.json` | 编辑器 + 类型检查（`noEmit: true`、`allowImportingTsExtensions: true`） |
| `tsconfig.dts.json` | 继承 base；只产 `.d.ts` 到 `lib/types/` |
| `tsdown.config.ts` | runtime bundle：`src/index.ts` → `lib/index.js` |
| `vitest.config.ts` | 测试发现：`tests/**/*.spec.ts` |
| `cordis.patch.yml` | 装到 `dsh-base` 上时 apply 的 patch |

### 视图怎么工作的

Ink 树是 Agent session log 的**纯投影**。[`src/state.ts`](src/state.ts) 里的 reducer 把每个 `SessionEvent` 映射成一个 `UiEntry`（user、assistant、tool call、compaction、plan、note）。`useSessionEvents`（[`src/hooks/useSessionEvents.ts`](src/hooks/useSessionEvents.ts)）首次渲染时从持久 log 回放种子，之后每个 `session/event` 来了就更新视图。

要加一种新事件类型：(1) 把 type 加到 `SessionEventMap`（如果还没有）；(2) 在 reducer 里加一个 case；(3) 在 `MessageList` 里渲染新 entry。

## 发版

```sh
# 1. bump package.json 里的 version（如需同步 bump peer）
# 2. 更新 README 里的版本号
# 3. build
pnpm run build
# 4. 发
npm publish --access public
```

当前版本 `0.1.0-rc.7`，跟 `dsh-*` peer 包同步发版。完整 peer 列表见 `package.json#peerDependencies`。

## 已知限制

- **`@` 只补全路径，不会把文件塞进消息。** 输入 `@src/pro` 再按 `Tab`，写进消息的是 `@src/prompt-layout.ts` 这段文字，文件内容不会被读取或内联。往 prompt 里放什么是 harness 的决定，不该由一个输入框替它做——何况模型自己就有文件工具，拿到路径就能打开。
- **续接 session 只能在启动时决定。** `DSH_TUI_RESUME=last`（或者一个 id）可以接上已存的 session，但没有会话内的 `/resume`。
- **长工具输出只给预览，展不开。** 会显示前 8 行，末尾加一条 `… 还有 N 行` 的标记；没有展开入口——要做展开就得引入这个应用刻意不要的选中模型。
- **`ctx.appExit` 由 launcher 提供。** 在 `dsh` CLI 外面跑会大声报错，直到 host 提供 exit hook。

## License

MIT
