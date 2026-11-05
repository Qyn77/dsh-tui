import { expect, it } from 'vitest'
import { createTerminalModes, interactionMode, VT } from '../src/terminal/adapters/modes.ts'
import { detectTerminal, TERMINAL_IDS } from '../src/terminal/adapters/profiles.ts'

it.each(TERMINAL_IDS)('%s uses the shared reversible lifecycle', (id) => {
  const writes: string[] = []
  const modes = createTerminalModes(s => writes.push(s), detectTerminal({ DSH_TUI_TERMINAL: id }, 'darwin'))
  modes.enter(); modes.enter()
  expect(writes).toHaveLength(1)
  modes.setPreference('off'); expect(writes.at(-1)).toContain('\u001b[?1007h')
  modes.suspend(); modes.suspend(); expect(writes.at(-1)).toContain(VT.leave)
  modes.setPreference('on'); modes.enter(); expect(writes.at(-1)).toContain('\u001b[?1006h')
  modes.dispose(); const length = writes.length
  modes.dispose(); modes.enter(); modes.setPreference('on'); expect(writes).toHaveLength(length)
  expect(writes.at(-1)).toContain(VT.wrapOn + VT.pasteOff)
})
it('uses a conservative nested default with an explicit override', () => {
  const env = detectTerminal({ TERM_PROGRAM: 'vscode', TMUX: '1' }, 'darwin')
  expect(interactionMode(env, 'auto')).toBe('alternate')
  expect(interactionMode(env, 'on')).toBe('mouse')
})
it('attempts cleanup after a failed entry write', () => {
  const writes: string[] = []
  const modes = createTerminalModes((s) => { writes.push(s); if (writes.length === 1) throw Error('write') }, detectTerminal({}, 'linux'))
  expect(() => { modes.enter() }).toThrow('write')
  modes.dispose(); expect(writes.at(-1)).toContain(VT.leave)
})
