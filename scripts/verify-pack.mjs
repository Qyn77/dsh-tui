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
 *   3. Every target declared in the package's `exports` is present.
 *   4. Nothing outside the declared allowlist sneaks in.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, posix } from 'node:path'
import ts from 'typescript'
import { findNpmCli } from './install.mjs'

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
  'lib/THIRD-PARTY-LICENSES.txt',
]

/** Top-level entries allowed in the tarball. Anything else is a leak. */
const ALLOWED_ROOTS = ['lib', 'cordis.patch.yml', 'package.json', 'LICENSE', 'README.md', 'README.zh.md']

/**
 * `npm pack --json` returns an object keyed by package name on npm 10+ and a
 * single-element array on older npm. Accept both so the gate is not pinned to
 * one npm minor.
 */
export async function packedPaths(directory = root, npmCli, execute = execFileSync) {
  // npm.cmd is not a directly executable program on Windows. Keep paths as
  // argv entries and use the same npm JavaScript entry discovery as installation.
  const cli = npmCli ?? await findNpmCli()
  const raw = execute(process.execPath, [cli, 'pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: directory,
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

/** Validate every condition, including type declarations, against the tarball. */
export function exportProblems(exports, paths) {
  const problems = []
  const visit = (value) => {
    if (value === null) return
    if (typeof value === 'string') {
      if (!value.startsWith('./')) {
        problems.push(`invalid export target: ${value}`)
      } else if (value.includes('*')) {
        const pattern = new RegExp('^' + value.slice(2).split('*')
          .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
        if (!paths.some(path => pattern.test(path))) problems.push(`export target has no packaged files: ${value}`)
      } else if (!paths.includes(value.slice(2))) problems.push(`missing exported entry: ${value}`)
    } else if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) visit(entry)
    }
  }
  visit(exports)
  return problems
}

/** Check emitted chunks with a parser so comments and example strings are ignored. */
export function importProblems(file, code, paths) {
  const problems = []
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const visit = (node) => {
    let target
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) target = node.moduleSpecifier
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) target = node.arguments[0]
    if (target && ts.isStringLiteralLike(target) && /^\.\.?\//.test(target.text)) {
      const resolved = posix.normalize(posix.join(posix.dirname(file), target.text))
      if (!paths.includes(resolved)) problems.push(`missing local import: ${file} -> ${target.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return problems
}

/** Map a shipped declaration back to the source that should have produced it. */
function sourceFor(declaration) {
  const stem = declaration.replace(/^lib\/types\//, '').replace(/\.d\.ts$/, '')
  return [join(root, 'src', `${stem}.ts`), join(root, 'src', `${stem}.tsx`)]
}

async function main() {
  const paths = await packedPaths()
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const problems = exportProblems(manifest.exports, paths)

  for (const path of paths) {
    if (path.endsWith('.js')) problems.push(...importProblems(path, readFileSync(join(root, path), 'utf8'), paths))
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
}

// Importing the checker in tests must not invoke npm or terminate the process.
const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null
if (invokedPath === await realpath(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`pack:check failed: ${error.message}`); process.exitCode = 1 })
}
