# `@deepseek-ai/dsh-tui`

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Claude Code 风格终端 UI。一个 Cordis bundle（`tui-runner`），骑在 `dsh-base` 之上，把默认的 Web UI 替换成全屏 Ink REPL。同一个 Agent、同样的工具、同样的模型 —— 换到终端里。

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ds · deepseek-official/deepseek-chat   session:tui-7a3  ⏵ idle  in:0 out:0│
└──────────────────────────────────────────────────────────────────────────┘

 ┌────────────────────────────────────────────────────────────────────────┐
 │ > 当前目录下有哪些文件？                                                │
 └────────────────────────────────────────────────────────────────────────┘
   ┌─ bash ─────────────────────────────────────────────────────────────┐
   │ ls -la                                                             │
   └────────────────────────────────────────────────────────────────────┘
   total 12
   drwxr-xr-x  3 user  staff   96 Aug 19 10:30 .
   drwx------  5 user  staff  160 Aug 19 10:30 ..
   -rw-r--r--  1 user  staff  403 Aug 19 10:30 README.md
   ✓ ok

╭──────────────────────────────────────────────────────────────────────────╮
│ > 问 dsh 任何事…                                                         │
╰──────────────────────────────────────────────────────────────────────────╯
```

## 用起来

```sh
# 1. 装 dsh CLI（一次）
npm install -g @deepseek-ai/dsh

# 2. 建 profile
mkdir -p ~/.dsh/profiles/tui && cd ~/.dsh/profiles/tui
pnpm init
pnpm add @deepseek-ai/dsh-base @deepseek-ai/dsh-tui
echo '[]' > cordis.yml

# 3. 启动
export DEEPSEEK_API_KEY=sk-...
dsh --profile tui
```

REPL 里：输入消息按 **Enter** 发送；**Ctrl-C** 取消当前 turn；**`/exit`** 退出。

| 命令 | 作用 |
| --- | --- |
| `Enter` | 把当前输入作为用户消息发给模型 |
| `/help` | 打印可用的斜杠命令 |
| `/clear` | 清空可见的聊天区（session log 不变） |
| `/status` | 打印当前模型和 session id |
| `/exit`, `/quit` | 退出 REPL |
| `Ctrl-C`（空闲时） | 等同 `/exit` |
| `Ctrl-C`（turn 运行时） | 取消正在跑的 turn |

要求：Node ≥ 22.19、pnpm ≥ 9、真正的终端（Ink 需要 TTY）、一个 DeepSeek API key。

## 改起来

```sh
# 1. 拉源码
git clone https://github.com/<your-fork>/dsh-tui.git
cd dsh-tui

# 2. 装依赖（构建工具 + 从 npm 拉的 harness peer）
pnpm install
pnpm approve-builds esbuild    # 一次性，允许 tsdown 的 bundler 跑 postinstall

# 3. 自检
pnpm run typecheck
pnpm test                      # 20 个单元测试，约 500ms
pnpm run build                 # tsc 产 .d.ts，tsdown 产 lib/index.js

# 4. 本地跑（不发版，用 link）
#    建一个指向本 checkout 的 link profile：
mkdir -p ~/.dsh/profiles/tui-dev && cd ~/.dsh/profiles/tui-dev
pnpm init
pnpm add @deepseek-ai/dsh-base @deepseek-ai/dsh-tui@link:/absolute/path/to/dsh-tui
echo '[]' > cordis.yml

export DEEPSEEK_API_KEY=sk-...
dsh --profile tui-dev
```

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

### 项目结构

```
src/
├── index.ts                 Cordis 插件入口：建 Agent，render <App/>
├── renderer.tsx             Ink 根组件
├── state.ts                 纯 reducer：SessionEvent → UiState
├── types.ts                 UiEntry、UiState、isRenderable、declaration-merged 事件表
├── commands.ts              /help /clear /status /exit /quit 派发
├── invariant.ts             空的 package-invariant companion
├── hooks/
│   └── useSessionEvents.ts  回放 log + 订阅 session/event
└── components/
    ├── StatusBar.tsx        顶部：模型 · session · 状态 · token
    ├── MessageList.tsx      中部：user / assistant / tool / compaction
    └── Prompt.tsx           底部：输入框

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

- **单行 prompt。** 多行输入靠 `\` + Enter 续行标记。真正的多行编辑器待办。
- **不能续接 session。** 每次启动都新建 `SessionId`（`tui-<uuid>`）。
- **没有 Tab 补全和 `@` 文件提及。**
- **`/compact` 没接通。** TUI 没有手动 compaction 入口；`dsh-base` 自己决定时机。
- **`ctx.appExit` 由 launcher 提供。** 在 `dsh` CLI 外面跑会大声报错，直到 host 提供 exit hook。

## License

MIT
