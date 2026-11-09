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
│  tui-01e62198 · v0.2.1-rc.5       deepseek-official/deepseek-v4-flash   │
│  ~/Desktop/dsh-tui (main*)           Tip: /help · /status · Tab completes │
╰──────────────────────────────────────────────────────────────────────────╯`;

export const en = {
  ui: {
    kicker: "DEEPSEEK HARNESS · TERMINAL EDITION",
    tagline: "Your agent. Your tools. Your terminal.",
    featuresLabel: "BUILT FOR THE WAY YOU WORK",
    featuresIntro: "Stay close to your code. Choose a model, bring your tools, and pick up where you left off.",
    installLabel: "GET STARTED",
    installLead: "A familiar terminal. A ready workspace.",
    installAside: "Choose your shell, install the matching runtime, then connect your model.",
    platformLabel: "Choose an installation terminal",
    platforms: ["macOS / Linux", "Windows · PS7", "Windows · CMD"],
    installStep: "Install for your terminal",
    keyStep: "Connect your model",
    startStep: "Make yourself at home",
    advanced: "Prerequisites and installation details",
    keyDetails: "Credential priority and third-party APIs",
    windowsWhy: "Why does Windows use curl?",
    windowsAnswer: "Windows 10 (1803+) and Windows 11 include curl.exe. It downloads the installer; Node executes it. We spell out curl.exe to avoid the curl alias in Windows PowerShell 5.1. Our PowerShell command requires PowerShell 7; the CMD command uses different environment-variable syntax.",
    windowsPanel: "curl.exe downloads the script, then Node runs it. Install PowerShell 7 first; launch the TUI in Windows Terminal + PowerShell 7. This is not a command for built-in PowerShell 5.1.",
    windowsSource: "Microsoft: curl on Windows",
    referenceLabel: "WHEN YOU NEED MORE",
    commandsIntro: "The essentials are one slash away. Open the reference when you need a reminder.",
    preview: "Interface preview",
    previewTask: "One request, a visible process, a clear result.",
    taskLabel: "Completed · process details",
    resultLabel: "Result",
    prompt: "Ask dsh anything…",
    copy: "Copy",
    copied: "Copied",
    copying: "Copying…",
    selected: "Selected",
    copySuccess: "Command copied to clipboard.",
    copyFailed: "Clipboard unavailable. Text selected; use your system copy shortcut.",
    skip: "Skip to content",
    footerNote: "A terminal presentation layer for DeepSeek Harness.",
    platformFoot: "macOS · Linux · Windows Terminal",
    brandNote: "Runtime 0.2.1-rc.5",
  },
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
    installCmd: 'dsh-tui',
    titleLead: 'DeepSeek Harness.',
    titleAccent: 'Right in your terminal.',
    lede: 'Read code, run tools, and build with your agent. A focused terminal workspace, powered by DeepSeek Harness.',
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
    title: 'Less switching. More building.',
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
    title: "Choose your terminal. Install with one command.",
    intro: "Start with Node ≥ 22.19 (including npm), Git and curl, plus access to GitHub/npm. The installer checks your environment and stops with instructions if something is missing; it does not install system prerequisites.",
    steps: [
      {
        "cmd": "curl -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/install.sh | bash",
        "note": "macOS / Linux"
      },
      {
        "cmd": "curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o \"$env:TEMP\\dsh-tui-install.mjs\" && node \"$env:TEMP\\dsh-tui-install.mjs\"",
        "note": "Windows PowerShell 7"
      },
      {
        "cmd": "curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o \"%TEMP%\\dsh-tui-install.mjs\" && node \"%TEMP%\\dsh-tui-install.mjs\"",
        "note": "Windows CMD — installation only; run the TUI in Windows Terminal + PowerShell 7"
      }
    ],
    notes: [
      "Choose ONE command above. PowerShell 7 is required on Windows even if you install from CMD.",
      "Builds current source and pins launcher/base/TUI to 0.2.1-rc.5. No global dsh or pnpm is needed. Do not substitute npm latest/next.",
      "Checks writable directories, at least 1 GiB of free space and dependency sources; native modules are verified before activation. Builds and backups may need more space."
    ],
    keyTitle: "Configure your API key",
    keyIntro: "For the official DeepSeek API, edit ~/.dsh/.env locally (Windows: %USERPROFILE%\\.dsh\\.env), preserving other entries. Replace the placeholder below with your key; never send the real key to a chat or commit it.",
    keyExample: "DEEPSEEK_API_KEY=YOUR_DEEPSEEK_API_KEY",
    keyNotes: [
      "On macOS/Linux, use `chmod 600 ~/.dsh/.env`. In Notepad, save as `.env`, not `.env.txt`. For a custom `--home` / `DSH_HOME`, use that directory instead.",
      "Credential priority: managed `.credentials.yaml` → process environment → project `.env` → home `.env`. Update an existing managed key through Desktop credential settings.",
      "Third-party APIs also need their own provider URL, model and credential mapping in the TUI profile."
    ],
    startTitle: "Open a new terminal, then launch",
    startNote: "On Windows, fully restart Windows Terminal and open PowerShell 7. After changing credentials, restart the TUI. Select your provider and model with /provider and /model.",
    desktopTitle: "Already using Harness Desktop?",
    desktopNotes: [
      "The same `DSH_HOME` shares credential storage and home configuration. Desktop-specific model/default-model/plugin settings are not automatically imported into the TUI profile.",
      "The installer uses its own pinned Harness runtime. Desktop’s private Node does not replace Node/npm/Git on your terminal PATH. Desktop itself is optional.",
      "Storage compatibility was checked for Desktop 0.2.2-rc.1 and TUI runtime 0.2.1-rc.5 on 2026-11-09. No live model request was made: opening the UI does not prove credentials are valid. Automatic desktop configuration import remains planned."
    ],
    full: "Full install guide, API key steps and recovery",
  },
  footer: {
    built: 'A Cordis bundle for',
    links: 'Usage · Spec · Develop',
  },
};

export const zh = {
  ui: {
    kicker: "DEEPSEEK HARNESS · 终端版",
    tagline: "同一个 Agent，熟悉的终端。",
    featuresLabel: "专注你的工作",
    featuresIntro: "不离开代码，不打断思路。选模型、接工具、继续上次的对话，都在终端里完成。",
    installLabel: "从这里开始",
    installLead: "打开终端，进入工作状态。",
    installAside: "选择你使用的终端，安装匹配的运行时，再连接自己的模型。",
    platformLabel: "选择安装终端",
    platforms: ["macOS / Linux", "Windows · PS7", "Windows · CMD"],
    installStep: "选择终端，开始安装",
    keyStep: "连接你的模型",
    startStep: "回到终端，开始对话",
    advanced: "前置条件与安装详情",
    keyDetails: "凭据优先级与第三方 API",
    windowsWhy: "Windows 为什么也用 curl？",
    windowsAnswer: "Windows 10（1803 起）和 Windows 11 自带 curl.exe。它负责下载脚本，Node 负责执行安装。写成 curl.exe 是为了避免 Windows PowerShell 5.1 中 curl 别名的歧义。本站 PowerShell 命令需要 PowerShell 7；CMD 的环境变量语法不同，请选择对应标签。",
    windowsPanel: "curl.exe 下载脚本，随后由 Node 执行。请先装好 PowerShell 7，运行 TUI 使用 Windows Terminal + PowerShell 7；不要把这条命令粘到系统自带的 PowerShell 5.1。",
    windowsSource: "微软官方：Windows 中的 curl",
    referenceLabel: "需要时，随手查阅",
    commandsIntro: "常用操作，一个斜杠就能找到。需要时展开，不必记住每条命令。",
    preview: "界面示意",
    previewTask: "一个需求，看得见的过程，清晰的结果。",
    taskLabel: "任务已完成 · 过程详情",
    resultLabel: "结果",
    prompt: "问 dsh 任何问题…",
    copy: "复制",
    copied: "已复制",
    copying: "复制中…",
    selected: "已选中",
    copySuccess: "命令已复制到剪贴板。",
    copyFailed: "无法直接写入剪贴板，已选中文本，请使用系统复制快捷键。",
    skip: "跳到正文",
    footerNote: "为 DeepSeek Harness 打造的终端界面。",
    platformFoot: "macOS · Linux · Windows Terminal",
    brandNote: "运行时 0.2.1-rc.5",
  },
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
    installCmd: 'dsh-tui',
    titleLead: '把 DeepSeek Harness',
    titleAccent: '搬进终端。',
    lede: '读代码、运行工具、与 Agent 一起完成工作。DeepSeek Harness 的能力，在你熟悉的终端里展开。',
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
    title: '少一点切换，多一点专注。',
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
    title: "选择你的终端，一条命令安装",
    intro: "先准备 Node ≥ 22.19（含 npm）、Git、curl，以及能访问 GitHub/npm 的网络。安装器会检查环境，缺少条件时停止并提示；不会自动安装系统前置工具。",
    steps: [
      {
        "cmd": "curl -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/install.sh | bash",
        "note": "macOS / Linux"
      },
      {
        "cmd": "curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o \"$env:TEMP\\dsh-tui-install.mjs\" && node \"$env:TEMP\\dsh-tui-install.mjs\"",
        "note": "Windows PowerShell 7"
      },
      {
        "cmd": "curl.exe -fsSL --connect-timeout 15 --max-time 120 https://raw.githubusercontent.com/Qyn77/dsh-tui/main/scripts/install.mjs -o \"%TEMP%\\dsh-tui-install.mjs\" && node \"%TEMP%\\dsh-tui-install.mjs\"",
        "note": "Windows CMD —— 仅用于安装；运行请用 Windows Terminal + PowerShell 7"
      }
    ],
    notes: [
      "以上命令三选一。Windows 即使通过 CMD 安装，也需要先装好 PowerShell 7。",
      "从当前源码构建，launcher/base/TUI 固定为 0.2.1-rc.5。无需全局 dsh 或 pnpm，不要替换为 npm latest/next。",
      "检查目录写权限、至少 1 GiB 空间和依赖源连接，激活前验证原生模块。源码构建和备份可能需要更多空间。"
    ],
    keyTitle: "配置 API Key",
    keyIntro: "使用 DeepSeek 官方 API 时，在本地编辑 ~/.dsh/.env（Windows 为 %USERPROFILE%\\.dsh\\.env），保留其他配置，将下面占位符换成自己的 Key。不要把真实密钥发到聊天或提交到仓库。",
    keyExample: "DEEPSEEK_API_KEY=YOUR_DEEPSEEK_API_KEY",
    keyNotes: [
      "macOS/Linux 保存后执行 `chmod 600 ~/.dsh/.env`；记事本保存为 `.env`，不要变成 `.env.txt`。自定义 `--home` / `DSH_HOME` 时使用实际目录。",
      "凭据优先级：托管 `.credentials.yaml` → 进程环境变量 → 项目 `.env` → home `.env`。已由桌面版管理的同名 Key，请从桌面版凭据设置更新。",
      "第三方 API 还需要在 TUI profile 配置对应服务地址、模型和凭据映射。"
    ],
    startTitle: "新开终端，然后启动",
    startNote: "Windows 需完全退出再打开 Windows Terminal，并使用 PowerShell 7。修改凭据后重启 TUI，通过 /provider 和 /model 选择提供方与模型。",
    desktopTitle: "已经安装了 Harness 桌面版？",
    desktopNotes: [
      "相同 `DSH_HOME` 可共用凭据存储与 home 根配置；桌面版专属模型、默认模型和插件配置不会自动导入 TUI profile。",
      "安装器独立安装固定版本的 Harness 运行时。桌面版内置 Node 不能替代终端 PATH 上的 Node/npm/Git；桌面版本身不是前置条件。",
      "2026-11-09 核对了桌面版 0.2.2-rc.1 与 TUI 运行时 0.2.1-rc.5 的存储兼容性，未发起真实模型请求：能打开界面不等于凭据有效。自动导入桌面版配置仍是待办。"
    ],
    full: "完整安装指南、密钥配置与故障恢复",
  },
  footer: {
    built: '一个为',
    links: '用法 · 设计契约 · 开发',
  },
};

export const strings = { en, zh };
export type Content = typeof en;
