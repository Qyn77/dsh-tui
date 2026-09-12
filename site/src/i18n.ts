const banner = `╭──────────────────────────────────────────────────────────────────────────╮
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
╰──────────────────────────────────────────────────────────────────────────╯`;

export const en = {
  lang: 'en',
  htmlLang: 'en',
  other: 'zh',
  otherLabel: '中文',
  otherHref: './zh/',
  meta: {
    title: 'dsh-tui — DeepSeek Harness in your terminal',
    description:
      'A Claude Code-style terminal UI for DeepSeek Harness. One Cordis bundle that mounts on dsh-base and replaces the default web UI with a full-screen Ink REPL — same agent, same tools, same model.',
  },
  nav: {
    features: 'Features',
    install: 'Install',
    commands: 'Commands',
    docs: 'Docs',
    source: 'Source',
  },
  hero: {
    installCmd: 'npm i @qiao-qyn/dsh-tui',
    titleLead: 'DeepSeek Harness,',
    titleAccent: 'in your terminal.',
    lede: 'A Claude Code-style terminal UI for DeepSeek Harness. One Cordis bundle that mounts on `dsh-base` and replaces the default web UI with a full-screen Ink REPL — same agent, same tools, same model.',
    ctaPrimary: 'Install it',
    ctaSecondary: 'Read the docs',
    altScreenNote:
      'Runs in the terminal’s alternate screen, like vim or htop — your scrollback comes back when you leave.',
  },
  terminal: {
    banner,
    lines: [
      '> fix the failing scroll test',
      '⏺ read_file({"file_path":"src/render/scroll.ts"}) ✓ 84 lines',
      '⏺ edit_file({"file_path":"src/render/scroll.ts"}) ✓',
      '⏺ bash("pnpm vitest run scroll") ✓ 12 passed',
      '✔ estimateEntryRows now counts the (+N more) row',
      '> ',
    ],
    status: ['tui-01e62198', 'deepseek-v4-flash', 'workspace-write'],
  },
  features: {
    title: 'Everything the harness does, at the width of your terminal',
    items: [
      {
        glyph: '/',
        title: 'Slash commands with pickers',
        body: '`/model `, `/permission `, `/mcp add` and `/skill ` open pickers over what is actually mounted, so you pick a name instead of guessing one.',
      },
      {
        glyph: '!',
        title: 'Shell escapes',
        body: '`!git status` runs it and shows the output; `!!` also hands it to the model. `!cd` moves the working directory and stays moved.',
      },
      {
        glyph: '@',
        title: 'File mentions',
        body: '`@src/pro` + `Tab` completes the path into your message. Nothing is read behind your back — the model opens the path with its own tools.',
      },
      {
        glyph: '⧉',
        title: 'Image attachments',
        body: 'Drop an image on the terminal and the path is pulled out of the text and sent as an attachment, with a chip confirming what went.',
      },
      {
        glyph: '⤷',
        title: 'Approvals that leave a record',
        body: 'A tool call that needs you gets a card with its arguments. The answer stays in the transcript, so a resumed session never shows a call that silently never ran.',
      },
      {
        glyph: '◆',
        title: 'Skills',
        body: '`/skill ` lists the user-invocable skills your assembly mounted. `Tab` fills the line, `Enter` runs it.',
      },
      {
        glyph: '↺',
        title: 'Sessions you can pick up',
        body: '`/sessions` lists what is stored, `/resume last` goes back to the newest, and `/history hide` starts the transcript at the new work.',
      },
      {
        glyph: '◐',
        title: 'Fits the room',
        body: '`/theme dark|light` follows an OSC 11 probe of your terminal, `/language en|zh` switches the chrome, `/keybinds vim` adds a normal mode.',
      },
    ],
  },
  commands: {
    title: 'The commands you reach for first',
    rows: [
      { cmd: '/help', desc: 'Print the slash commands' },
      { cmd: '/model', desc: 'Show the model; `/model ` opens a picker across every mounted provider' },
      { cmd: '/mcp', desc: 'Connected MCP servers and their tools; `/mcp add` connects one' },
      { cmd: '/permission', desc: 'Pick a sandbox + approval preset' },
      { cmd: '/context', desc: 'Context window, this session’s token spend, how full it is' },
      { cmd: '/copy', desc: 'Newest reply to your clipboard over OSC 52 — works through SSH' },
      { cmd: '! <cmd>', desc: 'Run a shell command; `!!` also shows it to the model' },
      { cmd: '/exit', desc: 'Leave the REPL' },
    ],
    more: 'Every command and keybinding, in full',
  },
  install: {
    title: 'Three commands',
    steps: [
      { cmd: 'npm install -g @deepseek-ai/dsh', note: 'the launcher, once per machine' },
      {
        cmd: 'npm i @deepseek-ai/dsh-base@next @qiao-qyn/dsh-tui',
        note: 'inside a profile — @next pins dsh-base to the same 0.1.0-rc.x line',
      },
      { cmd: 'dsh plugin --profile tui install && dsh --profile tui', note: 'register the bundles and launch' },
    ],
    notes: [
      'Needs Node ≥ 22.19 and a real TTY — iTerm / Terminal.app, or Windows Terminal + PowerShell 7.',
      'Your key goes in `~/.dsh/.env` once; dsh loads it on every launch.',
      'Prefer pnpm? Same steps with `pnpm add`, plus `pnpm approve-builds` once for the native modules.',
    ],
    full: 'Full install guide',
  },
  footer: {
    built: 'A Cordis bundle for',
    links: 'Usage · Spec · Develop',
  },
};

export const zh = {
  lang: 'zh',
  htmlLang: 'zh-CN',
  other: 'en',
  otherLabel: 'English',
  otherHref: '../',
  meta: {
    title: 'dsh-tui — 把 DeepSeek Harness 搬进终端',
    description:
      'DeepSeek Harness 的 Claude Code 风格终端 UI。一个 Cordis bundle 骑在 dsh-base 之上，把默认的 Web UI 换成全屏 Ink REPL —— 同一个 Agent、同样的工具、同样的模型。',
  },
  nav: {
    features: '特性',
    install: '安装',
    commands: '命令',
    docs: '文档',
    source: '源码',
  },
  hero: {
    installCmd: 'npm i @qiao-qyn/dsh-tui',
    titleLead: '把 DeepSeek Harness',
    titleAccent: '搬进终端。',
    lede: 'DeepSeek Harness 的 Claude Code 风格终端 UI。一个 Cordis bundle 骑在 `dsh-base` 之上，把默认的 Web UI 换成全屏 Ink REPL —— 同一个 Agent、同样的工具、同样的模型。',
    ctaPrimary: '开始安装',
    ctaSecondary: '看文档',
    altScreenNote: '跑在终端的备用屏里，和 `vim`、`htop` 一样 —— 退出后你原来的 scrollback 原样回来。',
  },
  terminal: {
    banner,
    lines: [
      '> 修一下挂了的 scroll 测试',
      '⏺ read_file({"file_path":"src/render/scroll.ts"}) ✓ 84 行',
      '⏺ edit_file({"file_path":"src/render/scroll.ts"}) ✓',
      '⏺ bash("pnpm vitest run scroll") ✓ 12 通过',
      '✔ estimateEntryRows 现在把（还有 N 条）那行也算进去了',
      '> ',
    ],
    status: ['tui-01e62198', 'deepseek-v4-flash', 'workspace-write'],
  },
  features: {
    title: 'harness 能做的事，按你终端的宽度重排一遍',
    items: [
      {
        glyph: '/',
        title: '带选择器的斜杠命令',
        body: '`/model `、`/permission `、`/mcp add`、`/skill ` 都会弹出选择器，列出真正挂载了的东西 —— 选一个，不用猜名字。',
      },
      {
        glyph: '!',
        title: '系统命令转义',
        body: '`!git status` 直接跑并把输出显示出来；`!!` 还会把它交给模型。`!cd` 切了目录就一直生效。',
      },
      {
        glyph: '@',
        title: '文件提及',
        body: '`@src/pro` 加 `Tab` 把完整路径补进你的消息。不会在背后偷偷读文件 —— 模型拿路径自己用工具打开。',
      },
      {
        glyph: '⧉',
        title: '图片附件',
        body: '把图片拖到终端里，路径会从正文摘掉、作为附件发出，消息里留一行 chip 说明发了什么。',
      },
      {
        glyph: '⤷',
        title: '审批会留下记录',
        body: '需要你点头的工具调用会弹出带参数的卡片。答案留在 transcript 里，所以恢复会话时不会看到一个"莫名没跑"的调用。',
      },
      {
        glyph: '◆',
        title: 'Skills',
        body: '`/skill ` 列出你的装配挂载的、允许用户调用的 skill。`Tab` 填进命令行，`Enter` 直接跑。',
      },
      {
        glyph: '↺',
        title: '随时接回的 session',
        body: '`/sessions` 列出存下来的会话，`/resume last` 回到最新那条，`/history hide` 让 transcript 从新内容开始。',
      },
      {
        glyph: '◐',
        title: '融入你的环境',
        body: '`/theme dark|light` 会先 OSC 11 探测你的终端，`/language en|zh` 切换界面语言，`/keybinds vim` 加一层 normal 模式。',
      },
    ],
  },
  commands: {
    title: '上手最先会用到的几条',
    rows: [
      { cmd: '/help', desc: '打印可用的斜杠命令' },
      { cmd: '/model', desc: '显示当前模型；`/model ` 打开所有已挂载 provider 的选择器' },
      { cmd: '/mcp', desc: '已连接的 MCP 服务器和它们的工具；`/mcp add` 连一个新的' },
      { cmd: '/permission', desc: '选择「沙箱 + 审批」打包预设' },
      { cmd: '/context', desc: '上下文窗口、本次 session 的 token 开销、当前占用多少' },
      { cmd: '/copy', desc: '把最新回复用 OSC 52 送进剪贴板 —— SSH 下也有效' },
      { cmd: '! <命令>', desc: '跑一条系统命令；`!!` 还会把它给模型看' },
      { cmd: '/exit', desc: '退出 REPL' },
    ],
    more: '完整的命令与按键表',
  },
  install: {
    title: '三条命令',
    steps: [
      { cmd: 'npm install -g @deepseek-ai/dsh', note: 'launcher，每台机器一次' },
      {
        cmd: 'npm i @deepseek-ai/dsh-base@next @qiao-qyn/dsh-tui',
        note: '在一个 profile 里装 —— @next 把 dsh-base 钉到同一代 0.1.0-rc.x',
      },
      { cmd: 'dsh plugin --profile tui install && dsh --profile tui', note: '注册 bundle 并启动' },
    ],
    notes: [
      '需要 Node ≥ 22.19 和一个真 TTY —— iTerm / Terminal.app，或 Windows Terminal + PowerShell 7。',
      'API key 一次性写进 `~/.dsh/.env`，dsh 每次启动都会读。',
      '想用 pnpm？把命令换成 `pnpm add`，另外跑一次 `pnpm approve-builds` 放行原生模块。',
    ],
    full: '完整安装说明',
  },
  footer: {
    built: '一个为',
    links: '用法 · 设计契约 · 开发',
  },
};

export const strings = { en, zh };
export type Content = typeof en;
