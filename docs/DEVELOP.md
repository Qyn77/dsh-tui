# Developing dsh-tui

How to run this repo from source, and how to ship it. English first, Chinese
second.

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
pnpm test                      # vitest, ~500ms
pnpm run build                 # tsc → .d.ts,  tsdown → lib/index.js

# 4. Create a link-mode profile that points at this checkout
mkdir -p ~/.dsh/profiles/tui-dev && cd ~/.dsh/profiles/tui-dev
pnpm init
# @next pins dsh-base to the same 0.1.0-rc.x line as this bundle; the `latest`
# dist-tag still points at the abandoned 0.0.1-rc.1.
pnpm add @deepseek-ai/dsh-base@next @qiao-qyn/dsh-tui@link:/absolute/path/to/dsh-tui
echo '[]' > cordis.yml

# 5. Register the bundles + approve native builds
dsh plugin --profile tui-dev install
pnpm approve-builds            # tick: node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. Set the API key (skip if ~/.dsh/.env already has one).
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
pnpm add @deepseek-ai/dsh-base@next "@qiao-qyn/dsh-tui@link:$PWD/../dsh-tui"
# $PWD assumes you cloned the repo as a sibling of `.dsh`. Otherwise
# pass the absolute path:  "@qiao-qyn/dsh-tui@link:C:/Users/you/Desktop/dsh-tui"
Set-Content -Path cordis.yml -Value "[]"

# 5. Register the bundles + approve native builds
dsh plugin --profile tui-dev install
pnpm approve-builds            # tick: node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. Set the API key (skip if $env:USERPROFILE\.dsh\.env already has one).
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

The test suite runs with no TTY and with color forced off, so four shipped
features are only ever exercised as arithmetic: the OSC 11 background probe, the
OSC 52 clipboard write, whether the colors picked from those two are legible
on your actual background, and whether a hook run's quiet and notable weights
actually look different.

```sh
pnpm tty-check          # run it in the terminal you actually use
```

It imports the real modules — no second copy of the sequences — prints what your
terminal answered, and ends three of its five checks with a question, because
"is this readable" and "did that reach your clipboard" are not things a program
can see. Anything you answer "no" to is a real bug the suite cannot catch.

### Project layout

```
src/
├── index.ts                  Cordis plugin entry — side effects
├── renderer.tsx              Ink root — wires state + components
├── invariant.ts              Type companion for dsh-invariants
├── core/                     Shared kernel: types, state reducer, services, i18n, width
├── prompt/                   The input line: editing, layout, paste, vim, @ mentions
├── pickers/                  Command-anchored pickers: skills, model, permission, mcp
├── mcp/                      MCP registry reads, /mcp layout, patch-layer reader/writer
├── shell/                    `!` escapes: pure parsing + the one spawner
├── attachments/              Image-path detection + the one reader of image bytes
├── commands/                 Slash-command dispatch and its backends
├── render/                   Transcript rendering: markdown, highlight, layout, scroll
├── terminal/                 Theme, settings, environment, resize, interrupt
├── hooks/
│   ├── useSessionEvents.ts   Replay log + live subscribe
│   ├── useMessageListScroll.ts  Scroll math + bindings
│   ├── useShell.ts           Runs `!`; the only caller of process.chdir
│   └── useStrings.tsx        The current language, as React context
└── components/               StatusBar, MessageList, Prompt, Markdown, Banner, SlashPalette

tests/                        vitest specs (`fake-tty.ts` = frame-level harness)
```

| Config file | Purpose |
| --- | --- |
| `tsconfig.json` | Editor + typecheck (`noEmit: true`, `allowImportingTsExtensions: true`) |
| `tsconfig.dts.json` | Extends base; declaration-only emit into `lib/types/` |
| `tsdown.config.ts` | Runtime bundle: `src/index.ts` → `lib/index.js` |
| `vitest.config.ts` | Test discovery: `tests/**/*.spec.ts` |
| `cordis.patch.yml` | The patch this bundle applies to `dsh-base` on install |

### How the view works

The Ink tree is a **pure projection** of the Agent's session log. The reducer in [`src/core/state.ts`](../src/core/state.ts) maps each `SessionEvent` to a `UiEntry` (user, assistant, tool call, compaction, plan, note). `useSessionEvents` ([`src/hooks/useSessionEvents.ts`](../src/hooks/useSessionEvents.ts)) seeds from the durable log on first render, then keeps the view in sync with each `session/event` arrival. Adding a new event type means: (1) add the type to `SessionEventMap` if it isn't already, (2) add a case in the reducer, (3) render the new entry in `MessageList`.

## Publish it

```sh
# 1. Bump version in package.json (and bump peer packages in lockstep if needed)
# 2. Update the version shown in the README banner sample, if you refresh it
# 3. Build
pnpm run build
# 4. Publish
npm publish --access public
```

The version is `0.1.0-rc.7`, in lockstep with the `dsh-*` peer packages. Bump them together when shipping a coordinated release. See `package.json#peerDependencies` for the full list.


---

# dsh-tui 开发指南

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
pnpm test                      # vitest，约 500ms
pnpm run build                 # tsc 产 .d.ts，tsdown 产 lib/index.js

# 4. 建一个指向本 checkout 的 link profile
mkdir -p ~/.dsh/profiles/tui-dev && cd ~/.dsh/profiles/tui-dev
pnpm init
# @next 把 dsh-base 钉到和本 bundle 同一代的 0.1.0-rc.x；latest 标签目前还
# 指向已弃用的 0.0.1-rc.1。
pnpm add @deepseek-ai/dsh-base@next @qiao-qyn/dsh-tui@link:/absolute/path/to/dsh-tui
echo '[]' > cordis.yml

# 5. 注册 bundle + 批准原生 build
dsh plugin --profile tui-dev install
pnpm approve-builds            # 勾选：node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. 设置 API key（如果 ~/.dsh/.env 里已经有了，跳过）。
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
pnpm add @deepseek-ai/dsh-base@next "@qiao-qyn/dsh-tui@link:$PWD/../dsh-tui"
# $PWD 假设你把仓库 clone 在 .dsh 同级目录。如果不是，把绝对路径写出来：
# "@qiao-qyn/dsh-tui@link:C:/Users/you/Desktop/dsh-tui"
Set-Content -Path cordis.yml -Value "[]"

# 5. 注册 bundle + 批准原生 build
dsh plugin --profile tui-dev install
pnpm approve-builds            # 勾选：node-pty, koffi, protobufjs, dsh-subprocess-local

# 6. 设置 API key（如果 $env:USERPROFILE\.dsh\.env 里已经有了，跳过）。
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

测试全程没有 TTY、颜色等级被钉死在 0，所以有四个已发布的特性只能被当成算术来验证：
OSC 11 背景探测、OSC 52 剪贴板写入、由这两者选出的颜色在你真实背景上是否看得清，
以及一次 hook 执行的两档轻重在屏幕上是否真的分得开。

```sh
pnpm tty-check          # 在你日常用的终端里跑
```

它直接 import 真实模块——不另抄一份转义序列——把你的终端回了什么打出来，
并且五项检查里有三项以提问收尾：「这段看得清吗」和「剪贴板里真的收到了吗」
不是程序能自己看见的事。任何一个你回答「否」的地方，都是测试套件抓不到的真 bug。

### 项目结构

```
src/
├── index.ts                  Cordis 插件入口（副作用都在这里）
├── renderer.tsx              Ink 根组件，接状态与组件
├── invariant.ts              dsh-invariants 的类型伴生文件
├── core/                     共享内核：types、state reducer、services、i18n、width
├── prompt/                   输入行：编辑、布局、粘贴、vim、`@` 提及
├── pickers/                  命令锚定的选择器：skill、model、permission、mcp
├── mcp/                      MCP 注册表读取、`/mcp` 布局、patch 层读写
├── shell/                    `!` 转义：纯解析 + 唯一的 spawner
├── attachments/              图片路径识别 + 唯一的图片字节读取处
├── commands/                 斜杠命令派发及其后端
├── render/                   对话渲染：markdown、高亮、布局、滚动
├── terminal/                 主题、设置、环境探测、resize、中断
├── hooks/
│   ├── useSessionEvents.ts   回放 log + 实时订阅
│   ├── useMessageListScroll.ts  滚动算术 + 按键绑定
│   ├── useShell.ts           执行 `!`；全包唯一调用 process.chdir 的地方
│   └── useStrings.tsx        当前语言，用 React context 传递
└── components/               StatusBar、MessageList、Prompt、Markdown、Banner、SlashPalette

tests/                        vitest 用例（`fake-tty.ts` 是帧级测试工具）
```

| 配置文件 | 作用 |
| --- | --- |
| `tsconfig.json` | 编辑器 + 类型检查（`noEmit: true`、`allowImportingTsExtensions: true`） |
| `tsconfig.dts.json` | 继承 base；只产 `.d.ts` 到 `lib/types/` |
| `tsdown.config.ts` | runtime bundle：`src/index.ts` → `lib/index.js` |
| `vitest.config.ts` | 测试发现：`tests/**/*.spec.ts` |
| `cordis.patch.yml` | 装到 `dsh-base` 上时 apply 的 patch |

### 视图怎么工作的

Ink 树是 Agent session log 的**纯投影**。[`src/core/state.ts`](../src/core/state.ts) 里的 reducer 把每个 `SessionEvent` 映射成一个 `UiEntry`（user、assistant、tool call、compaction、plan、note）。`useSessionEvents`（[`src/hooks/useSessionEvents.ts`](../src/hooks/useSessionEvents.ts)）首次渲染时从持久 log 回放种子，之后每个 `session/event` 来了就更新视图。

要加一种新事件类型：(1) 把 type 加到 `SessionEventMap`（如果还没有）；(2) 在 reducer 里加一个 case；(3) 在 `MessageList` 里渲染新 entry。

## 发版

```sh
# 1. bump package.json 里的 version（如需同步 bump peer）
# 2. 如要刷新 README 里的示例截图，顺手改里面的版本号
# 3. build
pnpm run build
# 4. 发
npm publish --access public
```

当前版本 `0.1.0-rc.7`，跟 `dsh-*` peer 包同步发版。完整 peer 列表见 `package.json#peerDependencies`。

