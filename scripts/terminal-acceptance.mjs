/** Run inside each native terminal and attach the output to the manual checklist. */
import { release } from 'node:os'
const names = ['TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'TERM', 'COLORTERM', 'VTE_VERSION', 'KONSOLE_VERSION']
const environment = Object.fromEntries(names.flatMap(name => process.env[name] ? [[name, process.env[name]]] : []))
console.log(JSON.stringify({ nativeAcceptance: 'pending-human-checks', node: process.version,
  platform: process.platform, osRelease: release(), arch: process.arch,
  tty: Boolean(process.stdin.isTTY && process.stdout.isTTY), columns: process.stdout.columns ?? null,
  rows: process.stdout.rows ?? null, environment,
  transport: { ssh: Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY),
    tmux: Boolean(process.env.TMUX), screen: Boolean(process.env.STY), wsl: Boolean(process.env.WSL_DISTRO_NAME) },
  checks: Object.fromEntries(['text-paste', 'image-paste', 'disclosure-click', 'native-selection', 'resize',
    'scroll-anchor', 'search-actions', 'attachments', 'mode-restoration'].map(name => [name, 'not-run'])),
}, null, 2))
