/** Build and replay the real Ink fixture in a Unix PTY; no model or clipboard access. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
if (process.platform === 'win32') throw new Error('This PTY harness requires macOS/Linux and Python 3; use the manual Windows Terminal matrix.')
const output = mkdtempSync(join(tmpdir(), 'dsh-terminal-pty-'))
try {
  execFileSync(process.execPath, [join(root, 'node_modules/tsdown/dist/run.mjs'),
    'tests/fixtures/terminal-pty.tsx', '--no-config', '--out-dir', output,
    '--platform', 'node', '--format', 'esm', '--no-dts', '--no-sourcemap'], { cwd: root, stdio: 'inherit' })
  symlinkSync(join(root, 'node_modules'), join(output, 'node_modules'), 'dir')
  execFileSync('python3', [join(root, 'scripts/terminal-pty-check.py'), join(output, 'terminal-pty.mjs')],
    { cwd: root, stdio: 'inherit' })
} finally {
  rmSync(output, { recursive: true, force: true })
}
