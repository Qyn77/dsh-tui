/**
 * Remove the build output so a stale artifact can never survive a rebuild.
 *
 * This exists because two zombie declarations — `lib/types/model.d.ts` and
 * `lib/types/sigint.d.ts` — outlived the deletion of their sources and were
 * still being packed for npm. `tsc --emitDeclarationOnly` writes into
 * `lib/types` without pruning it, and `tsdown` runs with `clean: false`
 * (cleaning `lib` would delete the `lib/types` that tsc just emitted, since
 * tsc runs first). So the wipe has to happen before both, which is here.
 */

import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

rmSync(join(root, 'lib'), { recursive: true, force: true })
