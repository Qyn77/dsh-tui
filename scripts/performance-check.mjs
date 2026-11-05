import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
execFileSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/performance.spec.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DSH_TUI_BENCH: '1' },
})
