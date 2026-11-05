import { mouseModeSequence, MOUSE_MODE_EXIT, type MousePreference, type MouseMode } from '../mouse.ts'
import type { TerminalEnvironment } from './profiles.ts'

export const VT = {
  enter: '\u001b[?1049h\u001b[2J\u001b[H', leave: '\u001b[?1049l',
  clear: '\u001b[2J\u001b[H', wrapOff: '\u001b[?7l', wrapOn: '\u001b[?7h',
  pasteOn: '\u001b[?2004h', pasteOff: '\u001b[?2004l', cursorOn: '\u001b[?25h', cursorOff: '\u001b[?25l',
} as const

export function interactionMode(environment: TerminalEnvironment, preference: MousePreference): MouseMode {
  if (preference !== 'auto') return preference === 'on' ? 'mouse' : 'alternate'
  return environment.profile.pointer === 'expected' && environment.multiplexer === 'none' ? 'mouse' : 'alternate'
}

/** Single lifecycle owner. Cleanup is idempotent, including a failed enter write. */
export function createTerminalModes(write: (text: string) => unknown, environment: TerminalEnvironment,
  preference: MousePreference = 'auto') {
  let active = false
  let disposed = false
  let current = preference
  const leave = () => {
    if (!active) return
    active = false
    write(VT.wrapOn + VT.pasteOff + MOUSE_MODE_EXIT + VT.cursorOn + VT.leave)
  }
  return {
    get active() { return active },
    get mode() { return interactionMode(environment, current) },
    enter() {
      if (active || disposed) return
      active = true
      write(VT.enter + mouseModeSequence(interactionMode(environment, current)) + VT.wrapOff + VT.pasteOn + VT.cursorOff)
    },
    setPreference(next: MousePreference) {
      if (disposed) return
      current = next
      if (active) write(mouseModeSequence(interactionMode(environment, next)))
    },
    suspend: leave,
    dispose() { if (disposed) return; disposed = true; leave() },
  }
}
