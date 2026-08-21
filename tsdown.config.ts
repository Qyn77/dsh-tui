import { defineConfig } from 'tsdown'
import { createRequire } from 'node:module'

// Read the version at build time so the banner cannot drift from
// `package.json`. `src/environment.ts` guards the identifier with
// `typeof`, so dev and vitest runs (where no define applies) fall back
// to 'dev' instead of throwing a ReferenceError.
const { version } = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  dts: false,
  clean: false,
  define: {
    __DSH_TUI_VERSION__: JSON.stringify(version),
  },
})
