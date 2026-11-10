import { defineConfig } from 'tsdown'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { inkUnicode } from './scripts/ink-unicode.mjs'
import { thirdPartyLicenses } from './scripts/third-party-licenses.mjs'

// Read the version at build time so the banner cannot drift from
// `package.json`. `src/environment.ts` guards the identifier with
// `typeof`, so dev and vitest runs (where no define applies) fall back
// to 'dev' instead of throwing a ReferenceError.
const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return undefined }
}
const commit = git(['rev-parse', 'HEAD'])
const status = git(['status', '--porcelain'])

export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  dts: false,
  clean: false,
  plugins: [inkUnicode(), thirdPartyLicenses()],
  deps: { alwaysBundle: ['ink'], neverBundle: ['yoga-layout', 'react-reconciler', 'react-devtools-core'] },
  define: {
    __DSH_TUI_VERSION__: JSON.stringify(version),
    __DSH_TUI_COMMIT__: JSON.stringify(commit ?? null),
    __DSH_TUI_DIRTY__: JSON.stringify(status === undefined ? null : status !== ''),
  },
})
