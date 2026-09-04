/**
 * Real-TTY verification for the three things the automated suite cannot reach.
 *
 * Run it in the terminal you actually use:
 *
 * ```sh
 * pnpm tty-check
 * ```
 *
 * Everything in `tests/` runs with no TTY and with chalk's color level pinned to
 * 0, so three shipped features are covered by tests that can only see their
 * *arithmetic*: the OSC 11 background probe (`src/theme.ts`), the OSC 52
 * clipboard write (`src/clipboard.ts`), and whether the colors chosen from those
 * two are legible on a real background (`src/highlight.ts`, the brand tints).
 * `docs/TUI-ROADMAP.md` §7 makes "it works in a real TTY" an acceptance rule, and
 * this script is how that rule gets discharged for those three.
 *
 * It **imports the real modules** rather than reimplementing the sequences. A
 * checker with its own copy of the OSC 11 parser would verify the terminal and
 * prove nothing about the code that ships — which is the entire point of running
 * it. That is also why it is TypeScript run through Node's type stripping rather
 * than a `.mjs` beside `clean.mjs`: the source is TypeScript and the source is
 * the subject.
 *
 * Nothing here is a test. Two of the four checks end in a question only a human
 * looking at the screen can answer, and the script says so rather than printing
 * a green tick it has not earned.
 * @module @deepseek-ai/dsh-tui/scripts/tty-check
 */

import { BRAND_BLUE } from '../src/banner-art.ts'
import { createLineCache, highlightLang, loadTokenizer, type CodeLine } from '../src/highlight.ts'
import { multiplexerFromEnv, osc52 } from '../src/clipboard.ts'
import {
  BRAND_TINT_ON_DARK,
  BRAND_TINT_ON_LIGHT,
  PROBE_TIMEOUT_MS,
  appearanceFor,
  palette,
  parseColorFgBg,
  parseOsc11,
  probeAppearance,
  OSC11_QUERY,
  type Appearance,
} from '../src/theme.ts'

// Written as escapes, never as literal control bytes — same rule as
// `src/clipboard.ts`, where a raw ESC in source is invisible in every diff and
// every review that would otherwise catch it going missing.
const ESC = '\u001B'
const BEL = '\u0007'
const ST = `${ESC}\\`
const RESET = `${ESC}[0m`

/** Paint `text` in a truecolor hex, the way Ink's chalk would. */
function fg(hex: string, text: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${ESC}[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${text}${RESET}`
}

/**
 * Make control bytes visible so a reply can be read in the report.
 *
 * `ST` first: it *starts* with `ESC`, so replacing `ESC` first would shred it
 * into `<ESC>\` and the report would never show a string terminator.
 */
function show(raw: string): string {
  return raw
    .replaceAll(ST, '<ST>')
    .replaceAll(ESC, '<ESC>')
    .replaceAll(BEL, '<BEL>')
}

function heading(n: number, title: string): void {
  process.stdout.write(`\n${ESC}[1m${n}. ${title}${RESET}\n`)
}

/** A question the script cannot answer. Printed as a question, never as a result. */
function ask(question: string): void {
  process.stdout.write(`   ${fg('#FFB000', '?')} ${question}\n`)
}

function fact(label: string, value: string): void {
  process.stdout.write(`   ${label.padEnd(22)} ${value}\n`)
}

/**
 * Read one raw OSC 11 reply, for the report.
 *
 * `probeAppearance` deliberately returns only a verdict, so a diagnostic that
 * wants the bytes has to ask again. Two round trips instead of widening the
 * production API for a script's benefit — and the second one doubles as
 * evidence that the terminal answers *repeatably*, which a terminal that
 * answers once and then stops would fail.
 *
 * stdin is left exactly as it was found, pause included. Attaching a `data`
 * listener flips the stream to flowing mode, and a stream left flowing here
 * would race the `probeAppearance` call immediately after it.
 */
async function rawOsc11(): Promise<string> {
  const { stdin, stdout } = process
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return ''
  const wasRaw = stdin.isRaw
  const wasPaused = stdin.isPaused()
  let seen = ''
  const onData = (chunk: Buffer): void => { seen += chunk.toString('utf8') }
  try {
    stdin.setRawMode(true)
    stdin.on('data', onData)
    stdout.write(OSC11_QUERY)
    await new Promise<void>((resolve) => { setTimeout(resolve, PROBE_TIMEOUT_MS) })
  } finally {
    stdin.off('data', onData)
    stdin.setRawMode(wasRaw)
    if (wasPaused) stdin.pause()
  }
  return seen
}

function checkEnvironment(): void {
  heading(1, 'Environment')
  fact('stdin.isTTY', String(process.stdin.isTTY))
  fact('stdout.isTTY', String(process.stdout.isTTY))
  fact('TERM', process.env['TERM'] ?? '(unset)')
  fact('TERM_PROGRAM', process.env['TERM_PROGRAM'] ?? '(unset)')
  fact('COLORTERM', process.env['COLORTERM'] ?? '(unset)')
  fact('TMUX', process.env['TMUX'] === undefined ? '(unset)' : 'set')
  fact('multiplexer', multiplexerFromEnv() ?? 'none')
  const colorFgBg = process.env['COLORFGBG']
  fact('COLORFGBG', colorFgBg ?? '(unset)')
  fact('  → reads as', parseColorFgBg(colorFgBg) ?? 'nothing')
}

/**
 * Check 1: does this terminal answer OSC 11, and does the app read it right?
 * @returns the appearance the app resolved, for the checks that depend on it.
 */
async function checkBackground(): Promise<Appearance> {
  heading(2, 'OSC 11 — background detection')
  const raw = await rawOsc11()
  fact('raw reply', raw === '' ? fg('#FF6B6B', '(silence)') : show(raw))
  const rgb = parseOsc11(raw)
  if (rgb !== undefined) {
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
    fact('parsed', `r=${pct(rgb.r)} g=${pct(rgb.g)} b=${pct(rgb.b)}`)
    fact('appearanceFor', appearanceFor(rgb))
  }

  const started = Date.now()
  const probed = await probeAppearance({
    stdin: process.stdin,
    stdout: process.stdout,
    colorFgBg: process.env['COLORFGBG'],
  })
  const elapsed = Date.now() - started
  // What the app would actually use, fallbacks included — `index.ts` defaults to
  // dark when the probe comes back undefined.
  const resolved: Appearance = probed ?? 'dark'
  fact('probeAppearance', `${probed ?? '(undefined → dark)'} in ${elapsed}ms`)

  if (raw === '') {
    // Not a failure. A terminal that ignores OSC 11 is the common case, and the
    // fallback chain existing is why it is not a bug.
    process.stdout.write(
      `   ${fg('#FFB000', '!')} No reply. That is expected on some terminals — what matters is that\n`
      + `     the fallback answered in ~${elapsed}ms, not the full ${PROBE_TIMEOUT_MS}ms deadline`
      + ' twice over.\n',
    )
  }
  ask(`Is your terminal background actually ${fg('#4D6BFE', resolved)}?`)
  return resolved
}

/** Check 2: are the two absolute colors legible on the background you have? */
function checkColors(appearance: Appearance): void {
  heading(3, 'Absolute colors on your real background')
  const { brandTint } = palette(appearance)
  const other = appearance === 'dark' ? BRAND_TINT_ON_LIGHT : BRAND_TINT_ON_DARK
  process.stdout.write(`   ${fg(BRAND_BLUE, '████  #4D6BFE  DEEPSEEK — one value, both backgrounds')}\n`)
  process.stdout.write(`   ${fg(brandTint, `████  ${brandTint}  HARNESS — the ${appearance} tint, which is the one in use`)}\n`)
  process.stdout.write(`   ${fg(other, `████  ${other}  the ${appearance === 'dark' ? 'light' : 'dark'} tint — should look WORSE here`)}\n`)
  ask('Is the tint in use comfortable, and the other one visibly worse?')

  process.stdout.write('\n')
  process.stdout.write(`   ${ESC}[1mdeepseek/deepseek-chat${RESET}   ← bold, uncolored (what ships)\n`)
  process.stdout.write(`   ${ESC}[1;37mdeepseek/deepseek-chat${RESET}   ← bold white (what it was)\n`)
  ask('On a light background, does the second line vanish and the first survive?')
}

/** Check 3: does Shiki's chosen theme read on this background? */
async function checkHighlighting(appearance: Appearance): Promise<void> {
  heading(4, 'Syntax highlighting')
  const { shikiTheme } = palette(appearance)
  fact('theme in use', shikiTheme)
  const lang = highlightLang('ts')
  if (lang === undefined) throw new Error('ts should not be a plain language')
  const tokenizer = await loadTokenizer(lang, shikiTheme)
  if (tokenizer === undefined) {
    process.stdout.write(`   ${fg('#FF6B6B', 'FAIL')} the ts grammar did not load\n`)
    return
  }
  const source = [
    '// a comment, the first thing to become unreadable',
    'export async function probe(ms = 100): Promise<string> {',
    '  const reply = `waited ${ms}ms`   // template + number',
    '  return reply ?? "fallback"',
    '}',
  ].join('\n')
  const paint = (line: CodeLine): string =>
    line.map(t => (t.color === undefined ? t.text : fg(t.color, t.text))).join('')
  for (const line of createLineCache(tokenizer).lines(source)) {
    process.stdout.write(`   ${paint(line)}\n`)
  }
  ask('Is every token readable — especially the comment?')
}

/** Check 4: does the clipboard actually receive it? */
function checkClipboard(): void {
  heading(5, 'OSC 52 — clipboard')
  const multiplexer = multiplexerFromEnv()
  // A nonce, so a stale clipboard cannot be mistaken for a successful copy —
  // the failure this check exists to catch looks exactly like "nothing happened".
  const nonce = `dsh-tui clipboard check ${new Date().toISOString()}`
  const sequence = osc52(nonce, { multiplexer })
  fact('wrapped for', multiplexer ?? 'no multiplexer')
  fact('bytes sent', `${sequence.length}`)
  fact('sequence', show(sequence.length > 120 ? `${sequence.slice(0, 60)}…${sequence.slice(-20)}` : sequence))
  process.stdout.write(sequence)
  ask(`Paste somewhere. Do you get exactly: ${fg('#4D6BFE', nonce)}`)
  if (multiplexer === 'tmux') {
    process.stdout.write('     (under tmux this also needs `set-clipboard on` in your config)\n')
  }
}

async function main(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    // Same refusal the app makes, and for the same reason: every check below is
    // a question about a terminal, so a pipe has nothing to answer with.
    process.stderr.write('tty-check needs a real TTY on both stdin and stdout. Run it directly.\n')
    process.exitCode = 1
    return
  }
  process.stdout.write(`${ESC}[1mdsh-tui real-TTY check${RESET}\n`)
  process.stdout.write('Four checks. Two are measurements; two are questions only you can answer.\n')
  checkEnvironment()
  const appearance = await checkBackground()
  checkColors(appearance)
  await checkHighlighting(appearance)
  checkClipboard()
  process.stdout.write(
    `\n${ESC}[1mDone.${RESET} Anything answered "no" is a real-TTY bug the test suite cannot see —\n`
    + 'report it with the environment block above.\n',
  )
  // Shiki keeps a worker-ish handle alive on some versions; nothing is pending
  // that matters, and a diagnostic that hangs after printing is worse than one
  // that exits.
  process.exit(0)
}

await main()
