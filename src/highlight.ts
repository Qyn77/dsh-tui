/**
 * Syntax highlighting for assistant code blocks.
 *
 * The shape here follows `file-mentions.ts` (§3.1): everything a test needs to
 * pin is pure, and the one impure function — the dynamic `import('shiki')` and
 * its per-language grammar loads — sits in the same file so the whole feature
 * is readable in one place instead of split across a module for one `await`.
 *
 * **Why a line cache and not a memo on the block's text.** A code block is
 * re-rendered on every `assistant/chunk` event while the model is writing it
 * (§1.9), and Shiki's cost is proportional to what it is handed: measured on
 * this machine, one line is 0.11ms and a 200-line block is 15ms. Re-highlighting
 * the whole block per delta therefore degrades exactly where an agent is most
 * likely to be streaming — a long file — and would spend 30% of a core on it.
 * Tokenizing only the lines that changed is O(1) per delta at any block size.
 *
 * That is sound rather than an approximation because Shiki can be resumed:
 * `codeToTokens` returns the `grammarState` it ended a snippet in, and accepts
 * one to start from. Threading it line by line reproduces a whole-block
 * highlight **byte for byte**, including across a block comment and a multi-line
 * template literal — `tests/highlight.spec.ts` pins that equality against real
 * Shiki, because it is the assumption the cache is built on and the failure
 * mode if it broke would be silently wrong colors rather than a crash.
 * @module @deepseek-ai/dsh-tui/highlight
 */

/**
 * One run of identically-styled characters on one line — what a terminal can
 * draw in a single `<Text>`.
 *
 * The optional flags are absent rather than `false` when unset so a token
 * compares equal to the plain object a test writes by hand.
 */
export interface CodeToken {
  text: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

/** One line of highlighted code. An empty line is an empty token list. */
export type CodeLine = CodeToken[]

/**
 * Tokenize one line, resuming from `state`, and report the state it ended in.
 *
 * The state is `unknown` on purpose: it is Shiki's `GrammarState`, an opaque
 * handle whose only contract is that it goes back where it came from. Naming
 * the real type here would put a value import of Shiki in the pure half and
 * buy nothing — nothing in this file may inspect it.
 */
export type LineTokenizer = (line: string, state: unknown) => {
  line: CodeLine
  state: unknown
}

/**
 * Shiki's `FontStyle` bit flags. Redeclared rather than imported because the
 * enum is a value export, and this half of the file must stay importable
 * without Shiki loaded — a test tokenizer has to be able to produce styles.
 */
const ITALIC = 1
const BOLD = 2
const UNDERLINE = 4

/** Map one Shiki token onto the flags Ink's `<Text>` understands. */
export function codeToken(
  token: { content: string; color?: string | undefined; fontStyle?: number | undefined },
): CodeToken {
  // `fontStyle` is -1 ("not set") far more often than 0, and both mean plain.
  const style = Math.max(0, token.fontStyle ?? 0)
  return {
    text: token.content,
    ...token.color === undefined ? {} : { color: token.color },
    ...(style & BOLD) === 0 ? {} : { bold: true },
    ...(style & ITALIC) === 0 ? {} : { italic: true },
    ...(style & UNDERLINE) === 0 ? {} : { underline: true },
  }
}

/**
 * Fence words that mean "this is not a language", and so must not be handed to
 * a grammar loader.
 *
 * `text`/`txt`/`plaintext` are Shiki's own no-op language and would load
 * successfully, which is worse than failing: it costs a grammar load and a
 * tokenize pass to produce exactly the plain rendering we already have.
 * `console`, `output`, and `log` are what models write above captured program
 * output — not a language at all, and highlighting it as one invents structure
 * the text does not have.
 */
const PLAIN = new Set(['', 'text', 'txt', 'plaintext', 'plain', 'console', 'output', 'log'])

/**
 * The grammar name to ask Shiki for, or `undefined` to leave the block plain.
 *
 * Aliases are deliberately not translated here. Shiki already resolves the
 * short forms models actually write (`js`, `ts`, `py`, `sh`, `rb`, `yml`), and
 * a second alias table in this repo would be a copy that goes stale against
 * the one that decides. An unknown word is not an error either — it fails the
 * grammar load and the block stays plain, which is the same outcome as a fence
 * with no word at all.
 */
export function highlightLang(lang: string): string | undefined {
  const name = lang.trim().toLowerCase()
  return PLAIN.has(name) ? undefined : name
}

/** A per-block tokenizing cache. Not pure — it is the memory the block keeps. */
export interface LineCache {
  /** Highlighted lines for `code`, re-tokenizing only what changed. */
  lines: (code: string) => CodeLine[]
  /** How many lines have been handed to the tokenizer, ever. For tests. */
  tokenized: () => number
}

/**
 * A cache over one code block's lines, resumable across calls.
 *
 * The reuse test is line equality against the previous call, not "is the old
 * source a prefix of the new one". Streaming appends, so in practice the first
 * differing line is the last one — but an edit anywhere (a re-render with
 * corrected text, a `/clear` and replay) then costs only the lines from the
 * change onward instead of silently returning stale colors.
 *
 * `states[i]` is the grammar state *after* line `i`, so resuming at line `k`
 * starts from `states[k - 1]` and line 0 starts from `undefined`.
 */
export function createLineCache(tokenize: LineTokenizer): LineCache {
  let sources: string[] = []
  let lines: CodeLine[] = []
  let states: unknown[] = []
  let count = 0
  return {
    lines(code: string): CodeLine[] {
      const next = code.split('\n')
      let reuse = 0
      while (reuse < next.length && reuse < sources.length && next[reuse] === sources[reuse]) {
        reuse += 1
      }
      const out = lines.slice(0, reuse)
      const carried = states.slice(0, reuse)
      let state = reuse === 0 ? undefined : states[reuse - 1]
      for (let index = reuse; index < next.length; index += 1) {
        const step = tokenize(next[index] ?? '', state)
        out.push(step.line)
        carried.push(step.state)
        state = step.state
        count += 1
      }
      sources = next
      lines = out
      states = carried
      return out
    },
    tokenized: () => count,
  }
}

/**
 * The Shiki theme the palette comes from.
 *
 * One theme, and it assumes a dark terminal. That is a real limitation rather
 * than an oversight: a theme's colors are chosen against a known background,
 * and this app does not know its own yet. The v0.4 auto-theme item is what
 * makes this a pair; until then it is one constant so that change has one
 * place to happen.
 */
export const THEME = 'github-dark'

/** What `loadTokenizer` resolved to for a language, including "no grammar". */
const tokenizers = new Map<string, LineTokenizer | undefined>()

/** The highlighter itself, created at most once, on first use. */
let highlighter: Promise<{
  loadLanguage: (lang: string) => Promise<void>
  codeToTokens: (code: string, options: Record<string, unknown>) => {
    tokens: { content: string; color?: string | undefined; fontStyle?: number | undefined }[][]
    grammarState?: unknown
  }
}> | undefined

/**
 * A tokenizer for `lang`, or `undefined` if Shiki has no grammar for it.
 *
 * Both halves are lazy and both are cached, including the failures — a fence
 * word that is not a language must cost one rejected load for the whole
 * session, not one per render. Shiki is reached through a dynamic `import` so
 * that none of its 33ms of module evaluation and 29ms of highlighter setup
 * lands on the TUI's boot path: a session that never sees a code block never
 * pays for one.
 */
export async function loadTokenizer(lang: string): Promise<LineTokenizer | undefined> {
  const cached = tokenizers.get(lang)
  if (cached !== undefined || tokenizers.has(lang)) return cached
  try {
    highlighter ??= (async () => {
      const { createHighlighter } = await import('shiki')
      return await createHighlighter({ themes: [THEME], langs: [] }) as never
    })()
    const shiki = await highlighter
    await shiki.loadLanguage(lang)
    const tokenizer: LineTokenizer = (line, state) => {
      const result = shiki.codeToTokens(line, {
        lang,
        theme: THEME,
        ...state === undefined ? {} : { grammarState: state },
      })
      return { line: (result.tokens[0] ?? []).map(codeToken), state: result.grammarState }
    }
    tokenizers.set(lang, tokenizer)
    return tokenizer
  } catch {
    // An unknown language, or a Shiki that failed to load at all. Neither is
    // worth surfacing: the block renders exactly as it did before this feature.
    tokenizers.set(lang, undefined)
    return undefined
  }
}
