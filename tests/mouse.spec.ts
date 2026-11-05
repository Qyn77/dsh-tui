import { detectTerminal } from '../src/terminal/adapters/profiles.ts'
import { interactionMode } from '../src/terminal/adapters/modes.ts'
import type { MousePreference } from '../src/terminal/mouse.ts'
import { describe, expect, it } from 'vitest'
import {
  isMousePreference,
  mouseModeSequence,
  MOUSE_MODE_EXIT,
  parseMouseEvents,
} from '../src/terminal/mouse.ts'

const ESC = '\u001B'
const x10 = (button: number, x = 12, y = 4): string =>
  `${ESC}[M${String.fromCharCode(button + 32, x + 32, y + 32)}`

const resolveMouseMode = (pref: MousePreference, env: NodeJS.ProcessEnv) => interactionMode(detectTerminal(env, 'darwin'), pref)

describe('terminal mouse policy', () => {
  it('uses reporting for Apple Terminal and VS Code auto', () => {
    expect(resolveMouseMode('auto', { TERM_PROGRAM: 'Apple_Terminal' })).toBe('mouse')
    expect(resolveMouseMode('auto', { TERM_PROGRAM: 'vscode' })).toBe('mouse')
    expect(resolveMouseMode('auto', {})).toBe('alternate')
  })

  it('lets the user enable reporting or restore native pointer selection', () => {
    expect(resolveMouseMode('on', {})).toBe('mouse')
    expect(resolveMouseMode('off', { TERM_PROGRAM: 'Apple_Terminal' })).toBe('alternate')
    expect(['auto', 'on', 'off'].every(isMousePreference)).toBe(true)
    expect(isMousePreference('yes')).toBe(false)
  })

  it('resets both owned modes before switching and disables them on exit', () => {
    expect(mouseModeSequence('mouse')).toBe(`${MOUSE_MODE_EXIT}${ESC}[?1000h${ESC}[?1006h`)
    expect(mouseModeSequence('alternate')).toBe(`${MOUSE_MODE_EXIT}${ESC}[?1007h`)
    expect(MOUSE_MODE_EXIT).toBe(`${ESC}[?1000l${ESC}[?1006l${ESC}[?1007l`)
  })
})

describe('mouse event decoding', () => {
  it('reads raw SGR and Ink-normalized wheel reports with modifiers', () => {
    expect(parseMouseEvents(`${ESC}[<64;12;4M[<93;3;8M`)).toEqual([
      { kind: 'wheel', delta: 1, x: 12, y: 4, shift: false, alt: false, ctrl: false },
      { kind: 'wheel', delta: -1, x: 3, y: 8, shift: true, alt: true, ctrl: true },
    ])
  })

  it('reads legacy X10 wheels and combines mixed bursts', () => {
    expect(parseMouseEvents(`${x10(64)}[<65;2;3M${x10(65)}`).map(event =>
      event.kind === 'wheel' ? event.delta : 0)).toEqual([1, -1, -1])
  })

  it('keeps coordinates and distinguishes press, release and motion', () => {
    expect(parseMouseEvents('[<0;12;4M[<0;12;4m[<32;13;5M').map(event =>
      [event.kind, event.x, event.y])).toEqual([
      ['press', 12, 4], ['release', 12, 4], ['move', 13, 5],
    ])
    expect(parseMouseEvents(x10(3))[0]?.kind).toBe('release')
  })

  it('does not turn horizontal wheels, button releases or malformed input into vertical scroll', () => {
    expect(parseMouseEvents('[<66;1;1M[<67;1;1M[<64;1;1m')).toEqual([])
    expect(parseMouseEvents('text[<64;0;1M[<64;1;0M[M')).toEqual([])
    expect(parseMouseEvents('[<64;1;')).toEqual([])
  })
})
