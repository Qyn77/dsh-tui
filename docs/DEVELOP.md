# Developing dsh-tui

How to run this repo from source, and how to ship it. English first, Chinese
second.

## Develop it

For an ordinary installation, use [INSTALL.md](INSTALL.md). Development needs
Node >= 22.19, Git and pnpm 11.10.0 (matching `packageManager`).

```sh
git clone https://github.com/Qyn77/dsh-tui.git
cd dsh-tui
# npm exec supplies the pinned pnpm without changing a global installation.
npm exec --yes --package=pnpm@11.10.0 -- pnpm install --frozen-lockfile --ignore-scripts
npm exec --yes --package=pnpm@11.10.0 -- pnpm run typecheck
npm exec --yes --package=pnpm@11.10.0 -- pnpm test
npm exec --yes --package=pnpm@11.10.0 -- pnpm run build
npm pack
node scripts/install.mjs --profile tui-dev --package ./qiao-qyn-dsh-tui-0.2.1-rc.5.tgz
```

These commands also work in PowerShell 7. Use the exact `node .../launch.mjs`
command printed by the installer. Runtime native dependencies are installed
there; source build scripts are not needed for the pinned prebuilt toolchain.
If `tui-dev` already exists and is not installer-managed, choose `tui-dev-new`.
Do not overwrite an existing profile or `.env` to make the command succeed.

### The edit / rebuild / reinstall / restart loop

The launcher reads `lib/index.js`, never the TypeScript source. For this packaged
workflow, after a source change: stop the TUI, build, `npm pack`, rerun the
installer with `--package` and the same profile, then restart its generated
launcher. It retains the previous package/profile as a backup. Merely rebuilding
a checkout does not update an already installed tarball.

`pnpm test` and `pnpm run typecheck` run against source and do not need a build.
The installer default (without `--package`) builds remote `main`; it deliberately
does not pick up uncommitted local source.

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

### The website

The landing page at <https://qyn77.github.io/dsh-tui/> is an Astro project that lives on the **`site` branch** — an orphan branch, so `main` carries none of it:

```sh
git switch site
cd site && npm install && npm run dev      # http://localhost:4321/dsh-tui/
```

Pushing `site` runs `.github/workflows/pages.yml`, which builds `site/dist` and deploys it to GitHub Pages. Two things to know if you touch it: the copy lives in `site/src/i18n.ts` (English and Chinese side by side), and `base: '/dsh-tui'` in `site/astro.config.mjs` is what makes links work under the project subpath — drop it if the site ever moves to a custom domain.

## Publish it

```sh
# 1. Bump version in package.json (and bump peer packages in lockstep if needed)
# 2. Update the version shown in the README banner sample, if you refresh it
# 3. Build
pnpm run build
# 4. Publish
npm publish --access public
```

The version is `0.2.1-rc.5`, in lockstep with the `dsh-*` peer packages. Bump them together when shipping a coordinated release. See `package.json#peerDependencies` for the full list.


---

# dsh-tui 开发指南

## 改起来

普通安装用 [INSTALL.md](INSTALL.md)。开发需要 Node >= 22.19、Git 和
packageManager 固定的 pnpm 11.10.0。

```sh
git clone https://github.com/Qyn77/dsh-tui.git
cd dsh-tui
npm exec --yes --package=pnpm@11.10.0 -- pnpm install --frozen-lockfile --ignore-scripts
npm exec --yes --package=pnpm@11.10.0 -- pnpm run typecheck
npm exec --yes --package=pnpm@11.10.0 -- pnpm test
npm exec --yes --package=pnpm@11.10.0 -- pnpm run build
npm pack
node scripts/install.mjs --profile tui-dev --package ./qiao-qyn-dsh-tui-0.2.1-rc.5.tgz
```

PowerShell 7 也可执行上述命令。使用脚本输出的 `node .../launch.mjs` 启动；
运行时原生依赖由安装器处理。已有非托管 `tui-dev` 时换成 `tui-dev-new`，
不要为了安装覆盖现有 profile 或 `.env`。

### 编辑 / 重建 / 重装 / 重启循环

launcher 读取 `lib/index.js`，不会读取 TypeScript 源码。本流程使用安装包：
修改源码后先退出 TUI，再 build、`npm pack`、使用同一 profile 重跑
`--package` 安装，最后重启。安装器保留旧安装备份；仅 build 不会更新
已经装进 profile 的 tarball。

测试和类型检查直接使用源码。安装器不带 `--package` 时构建的是远程 `main`，
不会包含本地未提交修改。

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

### 项目主页

<https://qyn77.github.io/dsh-tui/> 这个落地页是一个 Astro 项目，放在 **`site` 分支**上 —— 那是一条孤儿分支，所以 `main` 里一点都没有：

```sh
git switch site
cd site && npm install && npm run dev      # http://localhost:4321/dsh-tui/
```

push `site` 会触发 `.github/workflows/pages.yml`，构建 `site/dist` 并部署到 GitHub Pages。改它之前要知道两件事：文案都在 `site/src/i18n.ts`（中英并排放），以及 `site/astro.config.mjs` 里的 `base: '/dsh-tui'` 是链接能带上项目子路径的原因 —— 哪天换成自定义域名，删掉这一行就行。

## 发版

```sh
# 1. bump package.json 里的 version（如需同步 bump peer）
# 2. 如要刷新 README 里的示例截图，顺手改里面的版本号
# 3. build
pnpm run build
# 4. 发
npm publish --access public
```

当前版本 `0.2.1-rc.5`，跟 `dsh-*` peer 包同步发版。完整 peer 列表见 `package.json#peerDependencies`。

