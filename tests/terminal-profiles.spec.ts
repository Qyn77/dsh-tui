import { describe, expect, it } from 'vitest'
import { detectTerminal, supportsConsole, TERMINAL_IDS } from '../src/terminal/adapters/profiles.ts'

describe('terminal profile detection', () => {
  it('rejects unknown Windows consoles even when a protocol profile is forced', () => {
    expect(supportsConsole({}, 'win32')).toBe(false)
    expect(supportsConsole({ TERM: 'xterm', DSH_TUI_TERMINAL: 'windows-terminal' }, 'win32')).toBe(false)
    expect(supportsConsole({ WT_SESSION: '1' }, 'win32')).toBe(true)
    expect(supportsConsole({}, 'darwin')).toBe(true)
    expect(supportsConsole({}, 'linux')).toBe(true)
  })
  const cases = [
    ['apple', { TERM_PROGRAM: 'Apple_Terminal' }], ['vscode', { TERM_PROGRAM: 'vscode', WT_SESSION: 'inherited' }],
    ['iterm2', { TERM_PROGRAM: 'iTerm.app' }], ['windows-terminal', { WT_SESSION: '1' }],
    ['vte', { VTE_VERSION: '7800' }], ['konsole', { KONSOLE_VERSION: '240800' }],
    ['kitty', { KITTY_WINDOW_ID: '1' }], ['ghostty', { TERM_PROGRAM: 'ghostty' }],
    ['wezterm', { TERM_PROGRAM: 'WezTerm' }], ['alacritty', { TERM: 'alacritty' }],
    ['warp', { TERM_PROGRAM: 'WarpTerminal' }], ['generic', { TERM: 'xterm-256color' }],
  ] as const
  it.each(cases)('selects %s using evidence, not an xterm guess', (id, env) => {
    expect(detectTerminal(env, 'darwin').profile.id).toBe(id)
  })
  it('does not interpret inherited object property names as terminal identities', () => {
    expect(detectTerminal({ TERM_PROGRAM: 'constructor' }, 'linux').profile.id).toBe('generic')
  })
  it('covers every registered profile', () => {
    expect(cases.map(([id]) => id).sort()).toEqual([...TERMINAL_IDS].sort())
  })
  it('honors a valid override and diagnoses invalid ones', () => {
    expect(detectTerminal({ DSH_TUI_TERMINAL: 'generic', TERM_PROGRAM: 'vscode' }, 'linux').profile.id).toBe('generic')
    expect(detectTerminal({ DSH_TUI_TERMINAL: 'typo' }, 'linux')).toMatchObject({ invalidOverride: true, profile: { id: 'generic' } })
  })
  it('composes transports without treating TERM=screen as proof of GNU screen', () => {
    expect(detectTerminal({ TMUX: '1', STY: '1', TERM_PROGRAM: 'iTerm.app' }, 'darwin')).toMatchObject({ multiplexer: 'tmux', profile: { id: 'iterm2' } })
    expect(detectTerminal({ TERM: 'screen-256color' }, 'linux').multiplexer).toBe('none')
    expect(detectTerminal({ STY: '1' }, 'linux').multiplexer).toBe('screen')
  })
  it('keeps clipboard location explicit under SSH and WSL', () => {
    expect(detectTerminal({ SSH_TTY: '/dev/pts/1' }, 'darwin').clipboard).toBe('unavailable')
    expect(detectTerminal({ SSH_TTY: '1', DSH_TUI_REMOTE_CLIPBOARD: 'host' }, 'darwin').clipboard).toBe('macos')
    expect(detectTerminal({ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux')).toMatchObject({ wsl: true, clipboard: 'unavailable' })
    expect(detectTerminal({ WSL_INTEROP: '1', DSH_TUI_WSL_CLIPBOARD: 'windows' }, 'linux').clipboard).toBe('windows')
    expect(detectTerminal({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, 'linux').clipboard).toBe('wayland')
    expect(detectTerminal({ DISPLAY: ':0' }, 'linux').clipboard).toBe('x11')
  })
})
