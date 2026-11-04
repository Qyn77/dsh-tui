/** Terminal input policy and mouse reports. No I/O or terminal probing. */

export type MousePreference = 'auto' | 'on' | 'off'
export type MouseMode = 'mouse' | 'alternate'

export function isMousePreference(value: string): value is MousePreference {
  return value === 'auto' || value === 'on' || value === 'off'
}

/** Apple Terminal may scroll its view instead of delivering alternate-scroll keys. */
export function resolveMouseMode(
  preference: MousePreference,
  env: { TERM_PROGRAM?: string | undefined },
): MouseMode {
  if (preference === 'on') return 'mouse'
  if (preference === 'off') return 'alternate'
  return env.TERM_PROGRAM === 'Apple_Terminal' ? 'mouse' : 'alternate'
}

/** Disable only the mouse/alternate-scroll modes this application owns. */
export const MOUSE_MODE_EXIT = '\u001B[?1000l\u001B[?1006l\u001B[?1007l'

/** Reset the previous policy before enabling its replacement. */
export function mouseModeSequence(mode: MouseMode): string {
  return MOUSE_MODE_EXIT + (mode === 'mouse'
    ? '\u001B[?1000h\u001B[?1006h'
    : '\u001B[?1007h')
}

interface MousePosition {
  /** One-based terminal cell coordinates. */
  x: number
  y: number
  shift: boolean
  alt: boolean
  ctrl: boolean
}

export type MouseEvent = MousePosition & (
  | { kind: 'wheel'; delta: 1 | -1 }
  | { kind: 'press' | 'release' | 'move'; button: number }
)

function decodeMouse(button: number, x: number, y: number, released: boolean): MouseEvent | undefined {
  if (![button, x, y].every(Number.isSafeInteger) || button < 0 || x < 1 || y < 1) return undefined
  const position = {
    x, y,
    shift: (button & 4) !== 0,
    alt: (button & 8) !== 0,
    ctrl: (button & 16) !== 0,
  }
  const which = button & 3
  if ((button & 64) !== 0) {
    // Buttons 66/67 are horizontal wheels. Releases never add a notch.
    if (released || which > 1) return undefined
    return { ...position, kind: 'wheel', delta: which === 0 ? 1 : -1 }
  }
  const kind = released || which === 3 ? 'release' : (button & 32) !== 0 ? 'move' : 'press'
  return { ...position, kind, button: which }
}

/** Decode raw or Ink-normalized SGR and legacy X10 reports, including bursts. */
export function parseMouseEvents(input: string): MouseEvent[] {
  const events: MouseEvent[] = []
  const reports = /\[<([0-9]+);([0-9]+);([0-9]+)([Mm])|\[M([\s\S])([\s\S])([\s\S])/g
  for (const match of input.matchAll(reports)) {
    const event = match[1] === undefined
      ? decodeMouse(match[5].charCodeAt(0) - 32, match[6].charCodeAt(0) - 32, match[7].charCodeAt(0) - 32, false)
      : decodeMouse(Number(match[1]), Number(match[2]), Number(match[3]), match[4] === 'm')
    if (event !== undefined) events.push(event)
  }
  return events
}
