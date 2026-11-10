/** Build and replay the real Ink fixture in a Unix PTY; no model or clipboard access. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'
import { inkUnicode } from './ink-unicode.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
if (process.platform === 'win32') throw new Error('This PTY harness requires macOS/Linux and Python 3; use the manual Windows Terminal matrix.')
execFileSync('python3', [join(root, 'tests/terminal-pty-driver-test.py')], { cwd: root, stdio: 'inherit' })
const output = mkdtempSync(join(tmpdir(), 'dsh-terminal-pty-'))
try {
  await build({ config: false, entry: [join(root, 'tests/fixtures/terminal-pty.tsx')],
    outDir: output, platform: 'node', format: 'esm', dts: false, sourcemap: false,
    plugins: [inkUnicode()],
    deps: { alwaysBundle: ['ink'], neverBundle: ['yoga-layout', 'react-reconciler', 'react-devtools-core'] } })
  symlinkSync(join(root, 'node_modules'), join(output, 'node_modules'), 'dir')
  execFileSync('python3', [join(root, 'scripts/terminal-pty-check.py'), join(output, 'terminal-pty.mjs'), ...process.argv.slice(2)],
    { cwd: root, stdio: 'inherit' })
} finally {
  rmSync(output, { recursive: true, force: true })
}
