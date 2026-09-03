/**
 * The bilingual string catalog for every piece of text this UI writes.
 *
 * Pure by contract: no React, no Ink, no I/O, no `process.env`. Same boundary
 * `markdown.ts` keeps from `Markdown.tsx` — this module is the strings, and
 * `hooks/useStrings.tsx` is how a component reaches them. That split is what
 * lets `tests/i18n.spec.ts` assert key parity between the two languages without
 * mounting anything.
 *
 * **English is the source of truth.** `EN` below defines the {@link Catalog}
 * shape; `ZH` is a translation of it. Adding a string means adding it to both,
 * and the parity test in `tests/i18n.spec.ts` is what makes forgetting the
 * second one a test failure rather than an English string leaking into a Chinese
 * screen.
 *
 * Two categories of text deliberately stay out of here:
 *
 * - **Brand art.** The whale, the block wordmark, and the slogan in
 *   `banner-art.ts` are pictures that happen to be made of characters. They are
 *   not copy and have no translation.
 * - **Plugin command descriptions.** `registryCommands()` reads them from
 *   `ctx.commands`, whose owner is the authority on what its own command is
 *   called and what it says about itself. We have never seen those strings and
 *   cannot translate them; a plugin that wants to be bilingual localizes itself.
 *
 * And one stays out for now rather than on principle: the `(+N more)` suffix in
 * `message-layout.ts`. `scroll.ts` measures that string's row count while
 * `MessageList` draws it, and paging is only invertible while the two agree
 * exactly — so localizing it means threading the language into the scroll
 * geometry in the same change. See `docs/SPEC.md` §3.10.
 *
 * Where a string is assembled from runtime values, the catalog holds a function
 * rather than a template with placeholders for the caller to fill. Sentence
 * structure differs between the two languages — Chinese puts the verb where
 * English puts the object — and a caller splicing labels together cannot
 * express that. Callers pass values; the catalog decides word order. Numbers
 * arrive pre-formatted, because how a token count is grouped is the caller's
 * policy, not a translation decision.
 * @module @deepseek-ai/dsh-tui/i18n
 */

import type { PluginPhase } from './plugins.ts'
import type { UsageLabels } from './usage.ts'
import { THEME_PREFS, type Appearance, type ThemePref } from './theme.ts'

/** The languages this UI is written in. */
export type Lang = 'en' | 'zh'

/** Every supported language, in the order `/language` lists them. */
export const LANGUAGES: readonly Lang[] = ['en', 'zh']

/**
 * Canonical names of the commands this surface owns, including the leading `/`.
 * The single source of the command *set*; their descriptions live per-language
 * in {@link Catalog.commands}, which is keyed by this union so a new command
 * cannot be added without a description in both languages.
 */
export const COMMAND_NAMES = [
  '/clear',
  '/context',
  '/exit',
  '/help',
  '/language',
  '/model',
  '/plugins',
  '/quit',
  '/status',
  '/theme',
  '/usage',
] as const

/** One of the built-in command names. */
export type CommandName = typeof COMMAND_NAMES[number]

/** Values `/context` needs rendered, already formatted for display. */
export interface ContextReport {
  /** `provider/model`, or the catalog's own "unknown". */
  model: string
  /** Advertised context window, grouped, or the catalog's own "unknown". */
  contextWindow: string
  /** Billed input tokens, grouped. Cumulative across the whole session. */
  input: string
  /** Output tokens, grouped. Cumulative across the whole session. */
  output: string
  /**
   * Tokens the conversation currently occupies, grouped, or absent when no turn
   * has reported usage. Distinct from {@link ContextReport.input}: this one can
   * go down, and it is the only one the percentage is derived from.
   */
  inContext?: string
  /** Percent of the window occupied, or `undefined` when it cannot be computed. */
  usagePercent?: number
}

/**
 * Every string this UI can put on screen, in one language.
 *
 * Grouped by where it appears rather than by what it says, so a change to one
 * component touches one group and a reviewer can check a screen against a
 * single block.
 */
export interface Catalog {
  /** The input box at the bottom of the screen. */
  prompt: {
    /** Shown in place of an empty buffer while input is accepted. */
    placeholder: string
    /** Shown in place of an empty buffer while a turn runs, after the spinner. */
    working: string
  }
  /** The floating `/` command palette. */
  palette: {
    /** The dim key legend on the palette's last row. */
    hint: string
    /** The same legend for the `@` file picker, which has nothing to run. */
    fileHint: string
    /** Shown instead of rows while the first directory scan is in flight. */
    scanning: string
  }
  /** The permission card that replaces the prompt while a tool waits. */
  approval: {
    /** Card heading, followed by the tool name. */
    title: string
    /** The dim key legend on the card's last row. */
    hint: string
    /** How many further questions are queued behind this one. */
    more: (count: number) => string
  }
  /** Rows in the conversation transcript. */
  entries: {
    /** Label above an assistant message. */
    assistant: string
    /** The turn/step provenance beside that label. */
    turnStep: (turn: number, step: number) => string
    /** Marker on an assistant message still being streamed. */
    streaming: string
    /** Whether plan mode was switched on or off. */
    planMode: (enabled: boolean) => string
    /** Header of an injected runtime-context row, before producer and form. */
    runtimeContext: string
    /**
     * Marker under a preview, naming how many lines it withheld.
     *
     * Always drawn `wrap="truncate"`, so this string may be any length in any
     * language without changing the entry's height — which is what lets it be
     * translated at all. See `docs/SPEC.md` §3.10.
     */
    hiddenLines: (count: number) => string
    /** Shown for every compaction stage before the last. */
    compacting: string
    /** Shown when compaction finishes. */
    compactionDone: string
  }
  /** The persistent header bar. */
  status: {
    /** Idle indicator, glyph included. */
    idle: string
    /** Running indicator label, between the spinner and the elapsed seconds. */
    working: string
    /** Label of the session id row. */
    session: string
    /** Label of the billed-input row. */
    input: string
    /** Label of the output row. */
    output: string
  }
  /** Rendered markdown blocks. */
  markdown: {
    /**
     * Prefix on a fenced code block's header, before the language tag. The tag
     * itself is the fence's own `` ```ts `` and is never translated.
     */
    codeFence: string
  }
  /** The one reserved row that says the viewport is not at the live tail. */
  scroll: {
    /**
     * How many rows sit below the viewport, and how to get back to them.
     * Takes the row count so a language can inflect on it — English needs the
     * plural `s`, Chinese needs no agreement at all.
     */
    hint: (rows: number) => string
  }
  /**
   * Chrome around a `!` shell escape. The command's own output is never in
   * here — those are the program's bytes, and translating them would be
   * inventing output it did not produce.
   */
  shell: {
    /** Shown for a bare `!` with no command after it. */
    usage: string
    /** Shown when a `!` command is still running and another is submitted. */
    busy: string
    /** Non-zero exit. Zero is silent: a command that worked says so by working. */
    exit: (code: number) => string
    /** The child died from a signal instead of exiting. */
    signalled: (signal: string) => string
    /** The timeout, not the command, ended it. */
    timedOut: (seconds: number) => string
    /** Output hit the byte cap and the rest was dropped. */
    truncated: string
    /** Marks a row whose command and output were queued for the model. */
    injected: string
    /**
     * `cd ~` with no `$HOME`, or `cd -` as the session's first `cd`. A `cd` that
     * fails for any other reason reports the error Node gives us, the same way
     * any other command's stderr is reported: unlocalized, because it is not
     * ours to word.
     */
    cdUnresolved: string
  }
  /** The startup splash. */
  banner: {
    /** The one-line "how to drive it" tip under the wordmark. */
    tip: string
  }
  /** One description per built-in command, for the palette and `/help`. */
  commands: Record<CommandName, string>
  /** Text a command writes into the transcript. */
  output: {
    /** Heading above the `/help` table. */
    helpHeading: string
    /** Stand-in for a fact that could not be read. */
    unknown: string
    /** Reported when a `/name` matched neither this table nor the registry. */
    unknownCommand: string
    /** `/status`. */
    status: (model: string, session: string) => string
    /** `/context`. */
    context: (report: ContextReport) => string
    /** Heading above the `/usage` table, given the number of turns. */
    usageHeading: (turns: number) => string
    /** Column and row labels for the `/usage` table. */
    usageLabels: UsageLabels
    /** `/usage` before any turn has reported tokens. */
    noUsage: string
    /** `/plugins`: heading above the table, given the number of rows. */
    pluginsHeading: (count: number) => string
    /** `/plugins` when the loader is mounted but has nothing to list. */
    noPlugins: string
    /** `/plugins` in an assembly with no loader — embedded hosts have none. */
    noLoader: string
    /** One word per lifecycle phase, for the table's right column. */
    pluginPhases: Record<PluginPhase, string>
    /** `/plugins` with words it could not read as a subcommand. */
    pluginUsage: string
    /** `/plugins enable|disable` naming nothing in the table. */
    pluginNotFound: (query: string) => string
    /** `/plugins enable|disable` naming several plugins at once. */
    pluginAmbiguous: (query: string, names: readonly string[]) => string
    /** The plugin is already in the state the user asked for. */
    pluginUnchanged: (name: string, enable: boolean) => string
    /** Written *after* the config file has been rewritten. */
    pluginToggled: (name: string, enable: boolean) => string
    /** The loader refused: the plugin failed to start, or to stop. */
    pluginToggleFailed: (name: string, reason: string) => string
    /** Refused: it is this UI, and disabling it would kill the screen. */
    pluginLockedSelf: (name: string) => string
    /** Refused: its switch is a `!!js` expression this must not overwrite. */
    pluginLockedExpression: (name: string) => string
    /** Refused: an ancestor group is off, so this switch decides nothing. */
    pluginLockedInherited: (name: string) => string
    /** `/model` with no argument. */
    modelUsage: (current: string) => string
    /** `/model` when no default-model service is mounted. */
    noModelService: string
    /** `/model` after a successful switch. */
    modelSwitched: (provider: string, model: string) => string
    /** `/language` with no argument. */
    languageUsage: (current: Lang) => string
    /** `/language` after a successful switch, written in the *new* language. */
    languageSwitched: string
    /** `/language` with an argument that named no known language. */
    unknownLanguage: (raw: string) => string
    /** `/theme` with no argument. */
    themeUsage: (current: ThemePref, detected: Appearance) => string
    /** `/theme` after a successful switch. */
    themeSwitched: (pref: ThemePref, appearance: Appearance) => string
    /** `/theme` with an argument that named no preference. */
    unknownTheme: (raw: string) => string
  }
}

/**
 * English — the source-of-truth catalog.
 *
 * Typed as `Catalog` rather than inferred, so a key added to {@link Catalog}
 * without an English string is a compile error here rather than a runtime
 * `undefined` on screen.
 */
const EN: Catalog = {
  prompt: {
    placeholder: 'Ask dsh anything…',
    working: 'working',
  },
  palette: {
    hint: '↑↓ navigate · Tab complete · Enter run · Esc dismiss',
    fileHint: '↑↓ navigate · Tab or Enter insert path · Esc dismiss',
    scanning: 'scanning files…',
  },
  approval: {
    title: 'Permission required',
    hint: 'y allow once · n deny · Esc deny',
    more: count => ` (+${count} more waiting)`,
  },
  entries: {
    assistant: 'assistant',
    turnStep: (turn, step) => ` · turn ${turn} step ${step}`,
    streaming: ' · streaming',
    planMode: enabled => `plan mode ${enabled ? 'on' : 'off'}`,
    runtimeContext: 'runtime context',
    hiddenLines: count => `… +${count} ${count === 1 ? 'line' : 'lines'}`,
    compacting: 'compacting…',
    compactionDone: 'compaction complete',
  },
  status: {
    idle: '⏵ idle',
    working: 'working',
    session: 'session:',
    input: 'in:',
    output: 'out:',
  },
  markdown: {
    codeFence: 'code · ',
  },
  scroll: {
    hint: rows => `↓ ${rows} more row${rows === 1 ? '' : 's'} below · End jumps to the latest`,
  },
  shell: {
    usage: 'Usage: !<command> to run it · !!<command> to also show the model',
    busy: 'A command is still running. Ctrl-C stops it.',
    exit: code => `exit ${code}`,
    signalled: signal => `killed by ${signal}`,
    timedOut: seconds => `timed out after ${seconds}s`,
    truncated: 'output truncated',
    injected: 'sent to the model',
    cdUnresolved: 'cd: nowhere to go',
  },
  banner: {
    // Kept short enough to fit the wordmark column at 80 columns, and only
    // advertises commands that exist today — a tip pointing at an
    // unimplemented command is worse than no tip.
    tip: 'Tip: /help · /status · Tab completes',
  },
  commands: {
    '/clear': 'Clear the visible chat (keeps the session log intact)',
    '/context': 'Show model, context window, and token usage',
    '/exit': 'Leave the REPL',
    '/help': 'Show the list of available commands',
    '/language': 'Switch the interface language: /language en or zh',
    '/model': 'Switch model: /model <name> or <provider>/<name>',
    '/plugins': 'List loaded plugins; /plugins enable|disable <name> switches one',
    '/quit': 'Alias for /exit',
    '/status': 'Print the current model and session id',
    '/theme': 'Choose the background the colors assume: /theme auto, dark, or light',
    '/usage': 'Break this session\'s token spend out turn by turn',
  },
  output: {
    helpHeading: 'Available commands:',
    unknown: 'unknown',
    unknownCommand: 'unknown command — /help lists them',
    status: (model, session) => `model: ${model}\nsession: ${session}`,
    context: (report) => {
      const lines = [
        `model: ${report.model}`,
        `context window: ${report.contextWindow}`,
        `billed input (session): ${report.input}`,
        `output (session): ${report.output}`,
      ]
      if (report.inContext !== undefined) {
        const percent = report.usagePercent === undefined ? '' : ` (${report.usagePercent}%)`
        lines.push(`in context now: ${report.inContext}${percent}`)
      }
      return lines.join('\n')
    },
    usageHeading: turns => `token spend, ${turns} turn${turns === 1 ? '' : 's'}:`,
    usageLabels: {
      turn: 'turn',
      input: 'input',
      output: 'output',
      total: 'total',
      earlier: count => `+${count} earlier`,
    },
    noUsage: 'No turn has reported token usage yet.',
    pluginsHeading: count => `plugins (${count}):`,
    noPlugins: 'The loader has no plugins to list.',
    noLoader: 'No plugin loader in this assembly — nothing to list.',
    pluginPhases: {
      active: 'active',
      loading: 'loading',
      pending: 'pending',
      unloading: 'unloading',
      failed: 'failed',
      absent: 'not started',
      disabled: 'disabled',
    },
    pluginUsage: 'Usage: /plugins\n       /plugins enable <name>\n       /plugins disable <name>\n\nEnabling or disabling rewrites the loader config file on disk.',
    pluginNotFound: query => `no plugin matches '${query}' — /plugins lists them`,
    pluginAmbiguous: (query, names) =>
      `'${query}' matches ${names.length} plugins:\n${names.map(name => `  ${name}`).join('\n')}\n\nName one of them exactly.`,
    pluginUnchanged: (name, enable) => `${name} is already ${enable ? 'enabled' : 'disabled'}.`,
    pluginToggled: (name, enable) =>
      `${enable ? 'Enabled' : 'Disabled'} ${name}, and saved that to the loader config.`,
    pluginToggleFailed: (name, reason) => `could not switch ${name}: ${reason}`,
    pluginLockedSelf: name =>
      `${name} is this interface — switching it off from inside itself would leave nothing to switch it back on. Edit the loader config directly.`,
    pluginLockedExpression: name =>
      `${name} is switched by an expression in the loader config, not a plain flag. Overwriting it here would throw that expression away — edit the config directly.`,
    pluginLockedInherited: name =>
      `${name} is off because a group containing it is off. Enable that group instead.`,
    modelUsage: current =>
      `Usage: /model <name>\nCurrent: ${current}\n\nUse /context to see context window and token usage.`,
    noModelService: 'No default model service available.',
    modelSwitched: (provider, model) => `Switched to ${provider}/${model}`,
    languageUsage: current =>
      `Usage: /language <${LANGUAGES.join('|')}>\nCurrent: ${current}\n\nThe choice is saved and applies to the next launch too.`,
    languageSwitched: 'Interface language switched to English.',
    unknownLanguage: raw => `unknown language '${raw}' — pick one of ${LANGUAGES.join(', ')}`,
    themeUsage: (current, detected) =>
      `Usage: /theme <${THEME_PREFS.join('|')}>\nCurrent: ${current}${current === 'auto' ? ` (detected ${detected})` : ''}\n\nOnly the code-block colors and the lighter brand tint change. Everything else is a named terminal color, which your terminal already resolves against its own background.`,
    themeSwitched: (pref, appearance) =>
      pref === 'auto'
        ? `Following the terminal's background, which reads as ${appearance}.`
        : `Colors now assume a ${pref} background.`,
    unknownTheme: raw => `unknown theme '${raw}' — pick one of ${THEME_PREFS.join(', ')}`,
  },
}

/**
 * Chinese.
 *
 * Two constraints the wording works around, both about columns rather than
 * meaning. The status bar pads its labels to a shared width and a CJK glyph is
 * two columns wide, so labels stay short — `会话` not `当前会话`. And the two
 * key legends sit on one unwrapped row inside a bordered box, so the key names
 * (`Tab`, `Esc`, `Enter`) stay untranslated: they are what is printed on the
 * keyboard, and translating them would both widen the row and describe a key
 * the user cannot find.
 */
const ZH: Catalog = {
  prompt: {
    placeholder: '问 dsh 任何问题…',
    working: '处理中',
  },
  palette: {
    hint: '↑↓ 选择 · Tab 补全 · Enter 执行 · Esc 关闭',
    fileHint: '↑↓ 选择 · Tab 或 Enter 插入路径 · Esc 关闭',
    scanning: '正在扫描文件…',
  },
  approval: {
    title: '需要授权',
    hint: 'y 允许一次 · n 拒绝 · Esc 拒绝',
    more: count => `（还有 ${count} 个待确认）`,
  },
  entries: {
    assistant: '助手',
    turnStep: (turn, step) => ` · 第 ${turn} 轮 第 ${step} 步`,
    streaming: ' · 输出中',
    planMode: enabled => `计划模式${enabled ? '已开启' : '已关闭'}`,
    runtimeContext: '运行时上下文',
    hiddenLines: count => `… 还有 ${count} 行`,
    compacting: '压缩中…',
    compactionDone: '压缩完成',
  },
  status: {
    idle: '⏵ 空闲',
    working: '处理中',
    session: '会话:',
    input: '输入:',
    output: '输出:',
  },
  markdown: {
    codeFence: '代码 · ',
  },
  scroll: {
    hint: rows => `↓ 下方还有 ${rows} 行 · End 回到最新`,
  },
  shell: {
    usage: '用法：!<命令> 直接执行 · !!<命令> 同时给模型看',
    busy: '还有命令在跑，Ctrl-C 可以停掉。',
    exit: code => `退出码 ${code}`,
    signalled: signal => `被 ${signal} 终止`,
    timedOut: seconds => `超过 ${seconds} 秒，已终止`,
    truncated: '输出已截断',
    injected: '已发给模型',
    cdUnresolved: 'cd：没有可去的目录',
  },
  banner: {
    tip: '提示：/help · /status · Tab 补全',
  },
  commands: {
    '/clear': '清空可见的聊天区（session log 不变）',
    '/context': '显示模型、上下文窗口和 token 用量',
    '/exit': '退出 REPL',
    '/help': '显示可用命令列表',
    '/language': '切换界面语言：/language en 或 zh',
    '/model': '切换模型：/model <名称> 或 <提供方>/<名称>',
    '/plugins': '列出已加载的插件；/plugins enable|disable <名字> 可以开关某一个',
    '/quit': '/exit 的别名',
    '/status': '打印当前模型和 session id',
    '/theme': '选择配色假定的背景：/theme auto、dark 或 light',
    '/usage': '按轮次拆开本次 session 的 token 开销',
  },
  output: {
    helpHeading: '可用命令：',
    unknown: '未知',
    unknownCommand: '未知命令 —— /help 可以列出全部',
    status: (model, session) => `模型：${model}\n会话：${session}`,
    context: (report) => {
      const lines = [
        `模型：${report.model}`,
        `上下文窗口：${report.contextWindow}`,
        `计费输入（本次会话累计）：${report.input}`,
        `输出（本次会话累计）：${report.output}`,
      ]
      if (report.inContext !== undefined) {
        const percent = report.usagePercent === undefined ? '' : `（${report.usagePercent}%）`
        lines.push(`当前上下文占用：${report.inContext}${percent}`)
      }
      return lines.join('\n')
    },
    usageHeading: turns => `token 开销，共 ${turns} 轮：`,
    usageLabels: {
      turn: '轮次',
      input: '输入',
      output: '输出',
      total: '合计',
      earlier: count => `更早 ${count} 轮`,
    },
    noUsage: '还没有任何一轮报告过 token 用量。',
    pluginsHeading: count => `插件（${count}）：`,
    noPlugins: '加载器里没有可列出的插件。',
    noLoader: '当前装配没有插件加载器，无从列起。',
    pluginPhases: {
      active: '运行中',
      loading: '加载中',
      pending: '等待中',
      unloading: '卸载中',
      failed: '失败',
      absent: '未启动',
      disabled: '已禁用',
    },
    pluginUsage: '用法：/plugins\n      /plugins enable <名字>\n      /plugins disable <名字>\n\n启用或禁用会改写磁盘上的 loader 配置文件。',
    pluginNotFound: query => `没有插件匹配「${query}」—— /plugins 可以列出全部`,
    pluginAmbiguous: (query, names) =>
      `「${query}」匹配到 ${names.length} 个插件：\n${names.map(name => `  ${name}`).join('\n')}\n\n请写全其中一个。`,
    pluginUnchanged: (name, enable) => `${name} 本来就是${enable ? '启用' : '禁用'}状态。`,
    pluginToggled: (name, enable) => `已${enable ? '启用' : '禁用'} ${name}，并写入 loader 配置。`,
    pluginToggleFailed: (name, reason) => `切换 ${name} 失败：${reason}`,
    pluginLockedSelf: name =>
      `${name} 就是当前这个界面——从它自己内部关掉它，就没有东西能再把它打开了。请直接改 loader 配置。`,
    pluginLockedExpression: name =>
      `${name} 的开关在 loader 配置里是一段表达式，不是普通布尔值。在这里覆盖会把那段表达式丢掉——请直接改配置。`,
    pluginLockedInherited: name =>
      `${name} 是因为它所在的分组被关掉了才没运行。请去启用那个分组。`,
    modelUsage: current =>
      `用法：/model <名称>\n当前：${current}\n\n用 /context 查看上下文窗口和 token 用量。`,
    noModelService: '没有可用的默认模型服务。',
    modelSwitched: (provider, model) => `已切换到 ${provider}/${model}`,
    languageUsage: current =>
      `用法：/language <${LANGUAGES.join('|')}>\n当前：${current}\n\n选择会被保存，下次启动同样生效。`,
    languageSwitched: '界面语言已切换为中文。',
    unknownLanguage: raw => `未知语言「${raw}」—— 请选择 ${LANGUAGES.join('、')}`,
    themeUsage: (current, detected) =>
      `用法：/theme <${THEME_PREFS.join('|')}>\n当前：${current}${current === 'auto' ? `（探测到 ${detected}）` : ''}\n\n只有代码块配色和那一档浅色品牌蓝会变。其余都是终端命名色，你的终端本来就会按自己的背景去解释它们。`,
    themeSwitched: (pref, appearance) =>
      pref === 'auto'
        ? `已跟随终端背景，探测结果是 ${appearance}。`
        : `配色已改为假定 ${pref} 背景。`,
    unknownTheme: raw => `未知主题「${raw}」—— 请选择 ${THEME_PREFS.join('、')}`,
  },
}

/** The catalogs, by language. Exported for the parity test to iterate. */
export const CATALOGS: Readonly<Record<Lang, Catalog>> = { en: EN, zh: ZH }

/**
 * The strings for one language.
 * @param lang - the language to read.
 * @returns that language's complete catalog.
 */
export function catalog(lang: Lang): Catalog {
  return CATALOGS[lang]
}

/**
 * Aliases `/language` accepts for each language, beyond the canonical code.
 *
 * A table rather than a chain of comparisons so the accepted spellings are
 * enumerable — both by the test and by a reader deciding whether to add one.
 * Every entry is lowercase; {@link parseLanguageArg} lowercases its input.
 */
const ALIASES: Readonly<Record<string, Lang>> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  'en-us': 'en',
  英文: 'en',
  英语: 'en',
  zh: 'zh',
  cn: 'zh',
  chinese: 'zh',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  中文: 'zh',
  简体: 'zh',
  中: 'zh',
}

/**
 * Resolve a `/language` argument to a language.
 *
 * Pure and total: anything unrecognized is `undefined`, which the command
 * reports rather than silently defaulting. Silently defaulting would leave the
 * user believing a typo had switched the language.
 * @param raw - the argument as typed, in any case, with surrounding space.
 * @returns the language, or `undefined` when the argument names none.
 */
export function parseLanguageArg(raw: string): Lang | undefined {
  return ALIASES[raw.trim().toLowerCase()]
}

/**
 * Narrow an arbitrary value to a {@link Lang}.
 *
 * Used at the two boundaries where a language arrives untyped: the settings
 * file, whose contents are whatever is on disk, and the plugin config.
 * @param value - any value, typically from parsed JSON.
 * @returns true when the value is a supported language code.
 */
export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}
