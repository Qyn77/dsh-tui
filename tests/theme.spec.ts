/**
 * Background detection: the parse, the threshold, and the deadline.
 *
 * The parse and the threshold are pure, so they are tested by calling them. The
 * probe is not, and it gets a fake stdin/stdout pair rather than a real
 * terminal — deliberately, because the case that has to be right is the one a
 * real terminal cannot be made to perform on demand: a terminal that never
 * answers at all. That is the *common* case (most terminals ignore OSC 11
 * silently), and the only way it can hurt is by hanging the boot.
 *
 * What these tests cannot cover is whether any particular real terminal answers
 * the query. That is a real-TTY check, per roadmap §7.
 * @module @deepseek-ai/dsh-tui/tests/theme.spec
 */

import { describe, expect, it, vi } from 'vitest'
import {
  LIGHT_THRESHOLD,
  OSC11_QUERY,
  appearanceFor,
  isThemePref,
  palette,
  parseColorFgBg,
  parseOsc11,
  probeAppearance,
  type ProbeStdin,
} from '../src/theme.ts'

/** Wrap a reply body in `OSC 11 ; … BEL`, the way most terminals send it. */
function reply(body: string): string {
  return `\u001B]11;${body}\u0007`
}

describe('parseOsc11', () => {
  it('reads the 4-digit form terminated by BEL', () => {
    expect(parseOsc11(reply('rgb:1e1e/1e1e/1e1e'))).toEqual({
      r: 0x1e1e / 0xffff,
      g: 0x1e1e / 0xffff,
      b: 0x1e1e / 0xffff,
    })
  })

  it('reads the same reply terminated by ESC backslash', () => {
    const st = parseOsc11('\u001B]11;rgb:1e1e/1e1e/1e1e\u001B\\')
    expect(st).toEqual(parseOsc11(reply('rgb:1e1e/1e1e/1e1e')))
  })

  it('scales each component by its own width, not by 16 bits', () => {
    // `rgb:f/f/f` is white. Read as if it were 16-bit it would be almost black,
    // which is not a small error — it is the opposite answer.
    expect(parseOsc11(reply('rgb:f/f/f'))).toEqual({ r: 1, g: 1, b: 1 })
    expect(parseOsc11(reply('rgb:ff/ff/ff'))).toEqual({ r: 1, g: 1, b: 1 })
    expect(appearanceFor(parseOsc11(reply('rgb:f/f/f')) ?? { r: 0, g: 0, b: 0 })).toBe('light')
  })

  it('reads the #rrggbb form', () => {
    expect(parseOsc11(reply('#ffffff'))).toEqual({ r: 1, g: 1, b: 1 })
  })

  it('accepts rgba, which some terminals answer with', () => {
    expect(parseOsc11(reply('rgba:0000/0000/0000'))).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('treats a reply with no terminator yet as no reply', () => {
    // This is the accumulate-and-retry path, not an error: the caller appends
    // the next chunk and asks again.
    expect(parseOsc11('\u001B]11;rgb:1e1e/1e1e')).toBeUndefined()
  })

  it('ignores input that is not a report', () => {
    expect(parseOsc11('hello')).toBeUndefined()
    expect(parseOsc11(reply('nonsense'))).toBeUndefined()
    expect(parseOsc11('\u001B[A')).toBeUndefined()
  })

  it('finds the report with other input around it', () => {
    expect(parseOsc11(`x${reply('rgb:0000/0000/0000')}y`)).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('appearanceFor', () => {
  it('calls black dark and white light', () => {
    expect(appearanceFor({ r: 0, g: 0, b: 0 })).toBe('dark')
    expect(appearanceFor({ r: 1, g: 1, b: 1 })).toBe('light')
  })

  it('weighs the channels, which averaging them would not', () => {
    // Yellow and mid-gray have the *same* channel average (2/3). Their
    // luminances are 0.93 and 0.40 — opposite sides of the threshold. An
    // implementation that averaged would have to call these two the same.
    const yellow = { r: 1, g: 1, b: 0 }
    const gray = { r: 0xaa / 0xff, g: 0xaa / 0xff, b: 0xaa / 0xff }
    expect((yellow.r + yellow.g + yellow.b) / 3)
      .toBeCloseTo((gray.r + gray.g + gray.b) / 3, 2)
    expect(appearanceFor(yellow)).toBe('light')
    expect(appearanceFor(gray)).toBe('dark')
  })

  it('calls a saturated blue background dark', () => {
    // `#000080` — the channel average is 0.17, but blue carries 7% of the
    // weight, so the real luminance is 0.02.
    expect(appearanceFor({ r: 0, g: 0, b: 0x80 / 0xff })).toBe('dark')
  })

  it('switches at the threshold', () => {
    // Constructed from the constant rather than hard-coded, so the two cannot
    // drift apart: a gray whose luminance is just under and just over.
    const at = (luminance: number) => ({
      r: gray(luminance),
      g: gray(luminance),
      b: gray(luminance),
    })
    expect(appearanceFor(at(LIGHT_THRESHOLD - 0.01))).toBe('dark')
    expect(appearanceFor(at(LIGHT_THRESHOLD + 0.01))).toBe('light')
  })
})

/** The sRGB channel value whose linearized value is `luminance`. */
function gray(luminance: number): number {
  return luminance ** (1 / 2.4) * 1.055 - 0.055
}

describe('parseColorFgBg', () => {
  it('reads the background from the last field', () => {
    expect(parseColorFgBg('15;0')).toBe('dark')
    expect(parseColorFgBg('0;15')).toBe('light')
  })

  it('reads it past a "default" in the middle', () => {
    expect(parseColorFgBg('15;default;0')).toBe('dark')
  })

  it('splits the standard palette at 7', () => {
    expect(parseColorFgBg('0;6')).toBe('dark')
    expect(parseColorFgBg('0;7')).toBe('light')
    expect(parseColorFgBg('0;8')).toBe('dark')
    expect(parseColorFgBg('0;9')).toBe('light')
  })

  it('says nothing about anything it cannot read', () => {
    expect(parseColorFgBg(undefined)).toBeUndefined()
    expect(parseColorFgBg('')).toBeUndefined()
    expect(parseColorFgBg('white;black')).toBeUndefined()
    // Out of the palette entirely — a 256-color index says nothing about the
    // 16 slots this heuristic knows how to read.
    expect(parseColorFgBg('0;234')).toBeUndefined()
  })
})

describe('palette', () => {
  it('pairs a Shiki theme with each appearance', () => {
    expect(palette('dark').shikiTheme).toBe('github-dark')
    expect(palette('light').shikiTheme).toBe('github-light')
  })

  it('gives the light appearance a tint that is actually darker', () => {
    // The bug this replaces: `#9BADFF` on white measures 2.14:1. Asserting the
    // direction rather than the value keeps the test about the contrast
    // requirement instead of about one designer's hex.
    expect(luminanceOf(palette('light').brandTint))
      .toBeLessThan(luminanceOf(palette('dark').brandTint))
  })
})

/** Relative luminance of a `#rrggbb` string, for the contrast assertions. */
function luminanceOf(hex: string): number {
  const rgb = parseOsc11(`\u001B]11;${hex}\u0007`)
  expect(rgb).toBeDefined()
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear(rgb?.r ?? 0) + 0.7152 * linear(rgb?.g ?? 0) + 0.0722 * linear(rgb?.b ?? 0)
}

describe('isThemePref', () => {
  it('accepts the three preferences and nothing else', () => {
    expect(isThemePref('auto')).toBe(true)
    expect(isThemePref('dark')).toBe(true)
    expect(isThemePref('light')).toBe(true)
    expect(isThemePref('solarized')).toBe(false)
    expect(isThemePref(undefined)).toBe(false)
    expect(isThemePref(2)).toBe(false)
  })
})

/** A stdin that records what was done to it and can answer on demand. */
function fakeStdin(overrides: Partial<ProbeStdin> = {}): ProbeStdin & {
  send: (chunk: string) => void
  raw: boolean[]
  listeners: number
} {
  const handlers = new Set<(chunk: Buffer | string) => void>()
  const raw: boolean[] = []
  return {
    isTTY: true,
    isRaw: false,
    setRawMode: (mode) => { raw.push(mode) },
    isPaused: () => false,
    pause: () => {},
    on: (_event, listener) => { handlers.add(listener) },
    off: (_event, listener) => { handlers.delete(listener) },
    send: (chunk) => { for (const handler of handlers) handler(chunk) },
    raw,
    get listeners() { return handlers.size },
    ...overrides,
  }
}

describe('probeAppearance', () => {
  it('asks the terminal and reads the answer', async () => {
    const stdin = fakeStdin()
    const written: string[] = []
    const probe = probeAppearance({
      stdin,
      stdout: { isTTY: true, write: (chunk) => { written.push(chunk); stdin.send(reply('rgb:ffff/ffff/ffff')) } },
    })
    expect(await probe).toBe('light')
    expect(written).toEqual([OSC11_QUERY])
  })

  it('accepts a reply split across chunks', async () => {
    // The reply is a dozen-odd bytes and nothing guarantees they arrive as one
    // read, so the accumulate path is not hypothetical.
    const stdin = fakeStdin()
    const probe = probeAppearance({
      stdin,
      stdout: {
        isTTY: true,
        write: () => {
          stdin.send('\u001B]11;rgb:0000/00')
          stdin.send('00/0000\u0007')
        },
      },
    })
    expect(await probe).toBe('dark')
  })

  it('gives up at the deadline when the terminal never answers', async () => {
    // The case that matters most: silence is how a terminal without OSC 11
    // declines, and the only harm it can do is hang the boot.
    const probe = probeAppearance({
      stdin: fakeStdin(),
      stdout: { isTTY: true, write: () => {} },
      timeoutMs: 5,
    })
    expect(await probe).toBeUndefined()
  })

  it('falls back to COLORFGBG when the terminal stays silent', async () => {
    const probe = probeAppearance({
      stdin: fakeStdin(),
      stdout: { isTTY: true, write: () => {} },
      timeoutMs: 5,
      colorFgBg: '0;15',
    })
    expect(await probe).toBe('light')
  })

  it('prefers the terminal to COLORFGBG when both speak', async () => {
    const stdin = fakeStdin()
    const probe = probeAppearance({
      stdin,
      stdout: { isTTY: true, write: () => { stdin.send(reply('rgb:0000/0000/0000')) } },
      colorFgBg: '0;15',
    })
    expect(await probe).toBe('dark')
  })

  it('restores raw mode and detaches its listener', async () => {
    const stdin = fakeStdin()
    await probeAppearance({
      stdin,
      stdout: { isTTY: true, write: () => { stdin.send(reply('rgb:0000/0000/0000')) } },
    })
    // On to leave it as found, off again: Ink sets its own raw mode at mount
    // and a stream left flowing here would race that.
    expect(stdin.raw).toEqual([true, false])
    expect(stdin.listeners).toBe(0)
  })

  it('does not write to a pipe', async () => {
    // Asking a pipe would put the escape sequence into whatever is reading the
    // other end, which is the one outcome worse than not knowing.
    const write = vi.fn()
    expect(await probeAppearance({
      stdin: fakeStdin({ isTTY: false }),
      stdout: { isTTY: true, write },
      colorFgBg: '0;15',
    })).toBe('light')
    expect(await probeAppearance({
      stdin: fakeStdin(),
      stdout: { isTTY: false, write },
    })).toBeUndefined()
    expect(write).not.toHaveBeenCalled()
  })

  it('survives a stdin that refuses raw mode', async () => {
    expect(await probeAppearance({
      stdin: fakeStdin({ setRawMode: () => { throw new Error('nope') } }),
      stdout: { isTTY: true, write: () => {} },
      timeoutMs: 5,
    })).toBeUndefined()
  })
})
