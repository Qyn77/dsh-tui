/** Pure terminal profiles. Expected protocol support is not observed support. */
export const TERMINAL_IDS = ['generic', 'apple', 'vscode', 'iterm2', 'windows-terminal', 'vte',
  'konsole', 'kitty', 'ghostty', 'wezterm', 'alacritty', 'warp'] as const
export type TerminalId = typeof TERMINAL_IDS[number]
export type Capability = 'expected' | 'unknown' | 'unsupported'
export interface TerminalProfile {
  id: TerminalId
  pointer: Capability
  desktopNotification: 'osc9' | 'bell'
  /** Compatibility hint only; an empty paste must still produce a valid image. */
  emptyPasteImage: boolean
  forwardedMetaV: boolean
}

function profile(id: TerminalId, options: Partial<TerminalProfile> = {}): TerminalProfile {
  return { id, pointer: id === 'generic' ? 'unknown' : 'expected',
    desktopNotification: 'bell', emptyPasteImage: false, forwardedMetaV: false, ...options }
}

/** Brand-specific policy over the shared VT implementation, not duplicate parsers. */
export const TERMINAL_PROFILES: Readonly<Record<TerminalId, TerminalProfile>> = {
  generic: profile('generic'),
  apple: profile('apple', { emptyPasteImage: true, forwardedMetaV: true }),
  vscode: profile('vscode', { emptyPasteImage: true, forwardedMetaV: true }),
  iterm2: profile('iterm2', { desktopNotification: 'osc9' }),
  'windows-terminal': profile('windows-terminal'),
  vte: profile('vte'),
  konsole: profile('konsole'),
  kitty: profile('kitty'),
  ghostty: profile('ghostty'),
  wezterm: profile('wezterm', { desktopNotification: 'osc9' }),
  alacritty: profile('alacritty'),
  warp: profile('warp', { desktopNotification: 'osc9' }),
}

export interface TerminalEnvironment {
  profile: TerminalProfile
  evidence: string
  invalidOverride: boolean
  platform: NodeJS.Platform
  remote: boolean
  wsl: boolean
  multiplexer: 'tmux' | 'screen' | 'none'
  clipboard: 'macos' | 'windows' | 'wayland' | 'x11' | 'unavailable'
}

/** Windows support requires the documented host; a protocol override is not host evidence. */
export function supportsConsole(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  return platform !== 'win32' || Boolean(env['WT_SESSION']?.trim())
}

export function detectTerminal(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): TerminalEnvironment {
  let id: TerminalId = 'generic'
  let evidence = 'fallback'
  const override = env['DSH_TUI_TERMINAL']
  const validOverride = TERMINAL_IDS.includes(override as TerminalId)
  const programs: Readonly<Record<string, TerminalId>> = {
    Apple_Terminal: 'apple', vscode: 'vscode', 'iTerm.app': 'iterm2',
    WezTerm: 'wezterm', ghostty: 'ghostty', WarpTerminal: 'warp',
    Alacritty: 'alacritty', kitty: 'kitty',
  }
  // An explicit terminal identifier outranks inherited hints (e.g. WT_SESSION in VS Code).
  if (validOverride) { id = override as TerminalId; evidence = 'DSH_TUI_TERMINAL' }
  else if (Object.hasOwn(programs, env['TERM_PROGRAM'] ?? '')) {
    id = programs[env['TERM_PROGRAM'] ?? '']; evidence = 'TERM_PROGRAM'
  } else {
    const hints: [string, TerminalId][] = [['KITTY_WINDOW_ID', 'kitty'], ['GHOSTTY_RESOURCES_DIR', 'ghostty'],
      ['WEZTERM_PANE', 'wezterm'], ['KONSOLE_VERSION', 'konsole'], ['VTE_VERSION', 'vte'], ['WT_SESSION', 'windows-terminal']]
    const hint = hints.find(([name]) => Boolean(env[name]))
    if (hint) { id = hint[1]; evidence = hint[0] }
    else if (env['TERM'] === 'alacritty') { id = 'alacritty'; evidence = 'TERM' }
    else if (env['TERM'] === 'xterm-kitty') { id = 'kitty'; evidence = 'TERM' }
    else if (env['TERM'] === 'xterm-ghostty') { id = 'ghostty'; evidence = 'TERM' }
  }
  const remote = Boolean(env['SSH_CONNECTION'] || env['SSH_CLIENT'] || env['SSH_TTY'])
  const wsl = platform === 'linux' && Boolean(env['WSL_DISTRO_NAME'] || env['WSL_INTEROP'])
  const multiplexer = env['TMUX'] ? 'tmux' : env['STY'] ? 'screen' : 'none'
  const clipboard = remote && env['DSH_TUI_REMOTE_CLIPBOARD'] !== 'host' ? 'unavailable'
    : wsl && env['DSH_TUI_WSL_CLIPBOARD'] === 'windows' ? 'windows'
      : platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows'
        : platform === 'linux' && env['WAYLAND_DISPLAY'] ? 'wayland'
          : platform === 'linux' && env['DISPLAY'] ? 'x11' : 'unavailable'
  return { profile: TERMINAL_PROFILES[id], evidence, invalidOverride: Boolean(override && !validOverride),
    platform, remote, wsl, multiplexer, clipboard }
}
