import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { VERSION } from './environment.ts'

declare const __DSH_TUI_COMMIT__: string
declare const __DSH_TUI_DIRTY__: boolean

/** The requested launcher profile, never inferred from the user's working directory. */
export function requestedProfile(argv: readonly string[]): string | undefined {
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--') break
    if (argv[i].startsWith('--profile=')) return argv[i].slice(10) || undefined
    if (argv[i] === '--profile') return argv[i + 1]?.startsWith('-') ? undefined : argv[i + 1]
  }
  return undefined
}

/** Identity of this loaded bundle; immutable and probed only on diagnostic demand. */
export function readBuildIdentity(moduleUrl = import.meta.url, argv = process.argv) {
  let modulePath: string | undefined
  let sha256: string | undefined
  try {
    modulePath = realpathSync(fileURLToPath(moduleUrl))
    sha256 = createHash('sha256').update(readFileSync(modulePath)).digest('hex')
  } catch { /* Source tooling or a non-file loader: report missing evidence explicitly. */ }
  return {
    version: VERSION,
    commit: typeof __DSH_TUI_COMMIT__ === 'string' ? __DSH_TUI_COMMIT__ : null,
    dirty: typeof __DSH_TUI_DIRTY__ === 'boolean' ? __DSH_TUI_DIRTY__ : null,
    requestedProfile: requestedProfile(argv) ?? null,
    modulePath: modulePath ?? null,
    sha256: sha256 ?? null,
    installation: modulePath?.includes('/node_modules/') ? 'installed' : modulePath ? 'source-or-local-build' : 'unknown',
  }
}
