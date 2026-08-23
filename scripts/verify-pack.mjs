/**
 * Assert the publish tarball contains exactly what it should.
 *
 * This is the regression test for a real escape: `files: ["lib"]` swept the
 * whole build directory, so `lib/types/model.d.ts` and
 * `lib/types/sigint.d.ts` — declarations whose sources had been deleted —
 * were still listed by `npm pack`, along with 27 `.d.ts.map` files whose
 * `sources` pointed at a `src/` the tarball does not ship. Nothing caught it
 * because nobody ran `npm pack` before publishing. Now CI does.
 *
 * Checks, in order of what they would have caught:
 *   1. Every shipped `.d.ts` has a matching source file under `src/`.
 *   2. No source maps are shipped (they would dangle without `src/`).
 *   3. The four entry points the package's `exports` promise are present.
 *   4. Nothing outside the declared allowlist sneaks in.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Files that must be in the tarball for the `exports` map to resolve. */
const REQUIRED = [
  'lib/index.js',
  'lib/invariant.js',
  'lib/types/index.d.ts',
  'lib/types/invariant.d.ts',
  'cordis.patch.yml',
  'package.json',
  'LICENSE',
]

/** Top-level entries allowed in the tarball. Anything else is a leak. */
const ALLOWED_ROOTS = ['lib', 'cordis.patch.yml', 'package.json', 'LICENSE', 'README.md', 'README.zh.md']

/**
 * `npm pack --json` returns an object keyed by package name on npm 10+ and a
 * single-element array on older npm. Accept both so the gate is not pinned to
 * one npm minor.
 */
function packedPaths() {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const parsed = JSON.parse(raw)
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
  if (entry?.files === undefined) {
    throw new Error('could not read the file list out of `npm pack --json`')
  }
  return entry.files.map((file) => file.path)
}

/** Map a shipped declaration back to the source that should have produced it. */
function sourceFor(declaration) {
  const stem = declaration.replace(/^lib\/types\//, '').replace(/\.d\.ts$/, '')
  return [join(root, 'src', `${stem}.ts`), join(root, 'src', `${stem}.tsx`)]
}

const paths = packedPaths()
const problems = []

for (const path of paths) {
  if (path.endsWith('.d.ts')) {
    if (!sourceFor(path).some((candidate) => existsSync(candidate))) {
      problems.push(`stale declaration with no source in src/: ${path}`)
    }
  }
  if (path.endsWith('.map')) {
    problems.push(`source map shipped without src/: ${path}`)
  }
  const root0 = path.split('/')[0]
  if (!ALLOWED_ROOTS.includes(root0)) {
    problems.push(`unexpected entry outside the allowlist: ${path}`)
  }
}

for (const required of REQUIRED) {
  if (!paths.includes(required)) problems.push(`missing required entry: ${required}`)
}

if (problems.length > 0) {
  console.error(`pack:check failed — ${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\nRun `pnpm run build` first; if that does not fix it, `package.json#files` is wrong.')
  process.exit(1)
}

console.log(`pack:check ok — ${paths.length} files, no stale declarations, no dangling maps`)
