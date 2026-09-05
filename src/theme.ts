/**
 * Which way the terminal's background leans, and what changes when it leans
 * the other way.
 *
 * Split the way {@link module:@deepseek-ai/dsh-tui/highlight highlight.ts} and
 * `file-mentions.ts` split: everything a test needs to pin is pure, and the one
 * function that touches the terminal ({@link probeAppearance}) is kept in the
 * same file so the reader sees the whole feature instead of chasing a second
 * module for one write and one listener.
 *
 * **Almost nothing in this app is background-blind, and that is the point.** Of
 * the ~70 colors the components name, nearly all are *named ANSI* colors —
 * `gray`, `cyan`, `yellow`. Those already adapt: the terminal resolves them
 * from the palette its user configured against their own background. Remapping
 * them per-appearance would replace a choice the user made with a guess this
 * process made, which is worse than doing nothing. So there is no palette swap
 * here. {@link Palette} carries only the values that are *hex* — the ones no
 * terminal gets to reinterpret, and therefore the only ones that can be wrong:
 * Shiki's theme and the light brand tint.
 *
 * The detection is best-effort by construction. A terminal that answers OSC 11
 * gets an exact answer; one that sets `COLORFGBG` gets a good one with no round
 * trip; one that does neither gets `dark`, which is what shipped and what most
 * terminals are. None of those paths can fail the boot, and `/theme` overrides
 * all three — which is also the escape hatch when the guess is wrong.
 * @module @deepseek-ai/dsh-tui/theme
 */

/** Which way the terminal's background leans. */
export type Appearance = 'dark' | 'light'

/** What the user asked for. `auto` means "ask the terminal". */
export type ThemePref = Appearance | 'auto'

/** Every value of {@link ThemePref}, in the order `/theme` lists them. */
export const THEME_PREFS: readonly ThemePref[] = ['auto', 'dark', 'light']

/**
 * Whether a value is a {@link ThemePref}.
 * @param value - anything, typically a parsed settings key or a command argument.
 * @returns true when it is one of the three preferences.
 */
export function isThemePref(value: unknown): value is ThemePref {
  return typeof value === 'string' && (THEME_PREFS as readonly string[]).includes(value)
}

/** A color the terminal reported, each channel normalized to 0..1. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * The hex-valued colors that have to change with the background.
 *
 * Deliberately short. See the module note: a named ANSI color is already the
 * terminal's own answer to this question, so the only colors listed here are
 * the ones written as hex, where no terminal is consulted.
 */
export interface Palette {
  /** The Shiki theme to tokenize code blocks with. */
  shikiTheme: string
  /**
   * The lighter brand tint — `HARNESS` and the whale's belly.
   *
   * `#9BADFF` measures 2.14:1 against white, which is not a readable tint but a
   * missing one. The light variant is the same hue walked down in lightness
   * until it clears the background instead of the foreground.
   */
  brandTint: string
}

/**
 * The colors for one appearance.
 *
 * `BRAND_BLUE` (`#4D6BFE`) is deliberately absent: 4.35:1 on white and 4.83:1
 * on black, so it is readable either way and a second version of it would be
 * two things to keep in sync for no gain.
 * @param appearance - which way the background leans.
 * @returns the hex colors to draw with.
 */
export function palette(appearance: Appearance): Palette {
  return appearance === 'light'
    ? { shikiTheme: 'github-light', brandTint: BRAND_TINT_ON_LIGHT }
    : { shikiTheme: 'github-dark', brandTint: BRAND_TINT_ON_DARK }
}

/** The lighter brand tint, as drawn on a dark background. */
export const BRAND_TINT_ON_DARK = '#9BADFF'

/**
 * The same tint walked the other way, for a light background.
 *
 * `BRAND_TINT_ON_DARK` measures 2.14:1 against white — not a faint tint but an
 * invisible one. This is the same hue taken *down* in lightness instead of up,
 * so it reads against a light background the way the original reads against a
 * dark one.
 */
export const BRAND_TINT_ON_LIGHT = '#3B4FA8'

/** Ask the terminal for its background color. */
export const OSC11_QUERY = '\u001B]11;?\u0007'

/**
 * A background-color report: `OSC 11 ; <color> ST`.
 *
 * Both string terminators are accepted because terminals disagree about which
 * one they send — `BEL` (`\x07`) is the common answer, `ESC \` is the one the
 * standard prefers — and a probe that only understood one would silently time
 * out on half the terminals it works on. The report may also arrive with other
 * bytes around it, so this matches rather than anchors.
 */
const OSC11_REPLY = /\u001B]11;([^\u0007\u001B]*)(?:\u0007|\u001B\\)/

/** `rgb:` components, each 1–4 hex digits. */
const RGB_REPLY = /^rgba?:([0-9A-Fa-f]{1,4})\/([0-9A-Fa-f]{1,4})\/([0-9A-Fa-f]{1,4})/

/** The `#rrggbb` form, and its 3-, 9- and 12-digit siblings. */
const HEX_REPLY = /^#([0-9A-Fa-f]{3,12})$/

/**
 * Read a background color out of whatever the terminal sent.
 *
 * Returns `undefined` for anything that is not a complete report, which
 * includes the case that matters most: a *partial* one. The reply can be split
 * across chunks, so the caller accumulates and re-parses, and "not yet" and
 * "not a reply" have to be the same answer for that loop to be correct.
 *
 * Components are scaled by their own width rather than assumed to be 16-bit.
 * `rgb:1e/1e/1e` and `rgb:1e1e/1e1e/1e1e` name the same color, and reading the
 * first as if it were the second would call a dark background almost black —
 * harmless here — while reading `rgb:f/f/f` as 16-bit would call *white*
 * black, which flips the answer.
 * @param chunk - bytes read from the terminal, possibly with other input mixed in.
 * @returns the color, or `undefined` when no complete report is present.
 */
export function parseOsc11(chunk: string): Rgb | undefined {
  const body = OSC11_REPLY.exec(chunk)?.[1]
  if (body === undefined) return undefined
  const rgb = RGB_REPLY.exec(body)
  if (rgb !== null) {
    // All three groups are mandatory in the pattern, so a match has all three.
    const [, r, g, b] = rgb
    return { r: scaleHex(r), g: scaleHex(g), b: scaleHex(b) }
  }
  const hex = HEX_REPLY.exec(body)?.[1]
  if (hex === undefined || hex.length % 3 !== 0) return undefined
  const width = hex.length / 3
  return {
    r: scaleHex(hex.slice(0, width)),
    g: scaleHex(hex.slice(width, width * 2)),
    b: scaleHex(hex.slice(width * 2)),
  }
}

/**
 * One hex component as a 0..1 fraction of its own maximum.
 * @param hex - 1–4 hex digits.
 */
function scaleHex(hex: string): number {
  return parseInt(hex, 16) / (16 ** hex.length - 1)
}

/**
 * The luminance at which a background stops being dark.
 *
 * 0.5 rather than something tuned: the interesting inputs are not near the
 * boundary. Terminals are configured near-black or near-white, and the
 * mid-luminance backgrounds that make a threshold worth arguing about (Solarized
 * dark at 0.02, Solarized light at 0.90) are not actually near it either.
 */
export const LIGHT_THRESHOLD = 0.5

/**
 * Which appearance a background color calls for.
 *
 * WCAG relative luminance, not the average of the channels: the eye weighs
 * green about ten times as heavily as blue, so a saturated blue background
 * (`#000080`, luminance 0.02) averages to 0.17 and is unmistakably dark, while
 * a saturated yellow (`#FFFF00`, luminance 0.93) averages to the same 0.67 as a
 * mid-gray and is unmistakably light. Averaging would call both of them the
 * same thing.
 * @param rgb - the reported background, channels in 0..1.
 * @returns the appearance whose colors will contrast with it.
 */
export function appearanceFor({ r, g, b }: Rgb): Appearance {
  const luminance = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
  return luminance > LIGHT_THRESHOLD ? 'light' : 'dark'
}

/**
 * Undo sRGB's transfer function, so the channel is proportional to light.
 * @param channel - one channel in 0..1.
 */
function linearize(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

/**
 * Read the appearance out of `COLORFGBG`.
 *
 * Some terminals (urxvt, and a few that copied it) publish `<fg>;<bg>` as
 * palette indices, sometimes with a `default` in between. It is worth reading
 * because it costs no round trip and cannot time out — but only as a fallback,
 * because it is a *palette index*, and a palette index only says which slot the
 * background came from, not what color the user put in that slot.
 *
 * The background is the last field. Indices 0–6 and 8 are the dark half of the
 * standard palette; 7 and 9–15 are the light half.
 * @param value - the environment variable's value, or `undefined`.
 * @returns the appearance, or `undefined` when the variable says nothing usable.
 */
export function parseColorFgBg(value: string | undefined): Appearance | undefined {
  if (value === undefined) return undefined
  const last = value.split(';').at(-1)?.trim()
  if (last === undefined || !/^\d+$/.test(last)) return undefined
  const index = Number(last)
  if (index > 15) return undefined
  return index === 7 || index >= 9 ? 'light' : 'dark'
}

/** How long the terminal gets to answer before the probe gives up. */
export const PROBE_TIMEOUT_MS = 100

/**
 * The parts of `process.stdin` the probe uses.
 *
 * Structural rather than `NodeJS.ReadStream` so a test can supply a plain
 * object, and every capability optional so a stream that lacks one is a
 * `undefined` answer rather than a crash.
 */
export interface ProbeStdin {
  isTTY?: boolean | undefined
  isRaw?: boolean | undefined
  setRawMode?: ((mode: boolean) => void) | undefined
  isPaused?: (() => boolean) | undefined
  pause?: (() => void) | undefined
  on: (event: 'data', listener: (chunk: Buffer | string) => void) => void
  off: (event: 'data', listener: (chunk: Buffer | string) => void) => void
}

/** The parts of `process.stdout` the probe uses. */
export interface ProbeStdout {
  isTTY?: boolean | undefined
  write: (chunk: string) => unknown
}

/** Wiring for {@link probeAppearance}. */
export interface ProbeOptions {
  stdin: ProbeStdin
  stdout: ProbeStdout
  /** Defaults to {@link PROBE_TIMEOUT_MS}. */
  timeoutMs?: number
  /** `process.env.COLORFGBG`, read by the caller so this stays testable. */
  colorFgBg?: string | undefined
}

/**
 * Ask the terminal what color its background is.
 *
 * **This must be called before Ink mounts, and the reason is not stylistic.**
 * After mount, stdin belongs to Ink, and `useMessageListScroll.ts` documents
 * both ways of sharing it that do not work: attaching a `data` listener flips
 * the stream to flowing mode and drains chunks out from under Ink's read loop,
 * and reading Ink's own event emitter *observes* a chunk without consuming it —
 * Ink still hands the same bytes to every `useInput`. A reply arriving after
 * mount would be typed into the prompt as garbage. Before mount there is no
 * one else reading, so the listener can be attached and removed cleanly.
 *
 * Raw mode is required and restored. Without it the terminal line-buffers, and
 * the reply is not delivered until the user presses Enter — which is to say,
 * never, because the deadline expires first.
 *
 * The deadline is the whole safety story. Most terminals that do not implement
 * OSC 11 ignore it silently, so "no answer" is the common case rather than the
 * exceptional one, and it has to cost a bounded wait and then nothing. The
 * caller is expected to fire this early and await it late — `index.ts` starts it
 * right after the TTY checks and reads it just before `render()`, with the
 * loader await, the resume plan, and agent creation in between, so the round
 * trip overlaps work that was happening anyway.
 * @param options - streams, deadline, and the `COLORFGBG` fallback.
 * @returns the appearance, or `undefined` when nothing could be determined.
 */
export async function probeAppearance(options: ProbeOptions): Promise<Appearance | undefined> {
  const { stdin, stdout, timeoutMs = PROBE_TIMEOUT_MS, colorFgBg } = options
  const fallback = parseColorFgBg(colorFgBg)
  // A pipe cannot answer, and asking would write the query into whatever is
  // reading the other end.
  if (stdin.isTTY !== true || stdout.isTTY !== true) return fallback
  if (typeof stdin.setRawMode !== 'function') return fallback

  const wasRaw = stdin.isRaw === true
  const wasPaused = stdin.isPaused?.() ?? false
  let seen = ''
  let settle: ((value: Appearance | undefined) => void) | undefined
  const onData = (chunk: Buffer | string): void => {
    seen += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    const rgb = parseOsc11(seen)
    // Not a complete reply *yet* is the same answer as not a reply, so this
    // simply waits for the next chunk. The deadline is what ends the wait.
    if (rgb !== undefined) settle?.(appearanceFor(rgb))
  }

  try {
    stdin.setRawMode(true)
    stdin.on('data', onData)
    const result = await new Promise<Appearance | undefined>((resolve) => {
      const timer = setTimeout(() => { resolve(fallback) }, timeoutMs)
      // `unref` so a probe still in flight cannot be the reason the process
      // stays alive — this runs during boot, and a boot that fails for another
      // reason should exit on its own schedule.
      timer.unref()
      settle = (value) => {
        clearTimeout(timer)
        resolve(value)
      }
      // Asked *after* `settle` exists, not before. A real terminal cannot
      // answer inside this call, but a test double can, and a reply that
      // arrived while `settle` was still undefined would be dropped and then
      // waited out — the one failure that would make the fast path untestable.
      stdout.write(OSC11_QUERY)
    })
    // Drain window: after the first reply lands, wait a short while longer so
    // any additional terminal reports (a second OSC 11, an OSC 10 foreground
    // report, or any other spontaneous bytes some terminals emit alongside
    // the answer) get consumed here rather than leaking into Ink's input
    // pipeline. The VS Code integrated terminal is known to do this. 20ms is
    // well above the typical 1–5ms round-trip and well below what a user
    // would notice during boot.
    await new Promise<void>(r => setTimeout(r, 20))
    return result
  } catch {
    // `setRawMode` throws on some stdin shapes, and a background color is never
    // worth failing a boot over.
    return fallback
  } finally {
    stdin.off('data', onData)
    // Leave stdin exactly as it was found. Ink sets its own raw mode on mount,
    // and a stream left flowing here would race that.
    try {
      stdin.setRawMode(wasRaw)
      if (wasPaused) stdin.pause?.()
    } catch {
      // Nothing to do about it, and nothing worth saying: the frame is next.
    }
  }
}
