import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function sessionFile(root: string, directory: string, session: string): string {
  return join(root, directory, `${createHash('sha256').update(session).digest('hex')}.json`)
}
export function readSessionData(path: string, maxBytes: number): { value?: unknown; failed?: true } {
  try {
    if (statSync(path).size > maxBytes) return { failed: true }
    return { value: JSON.parse(readFileSync(path, 'utf8')) as unknown }
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? {} : { failed: true }
  }
}
/** Replace atomically with private permissions; never truncate a previous value. */
export function writeSessionData(path: string, value: unknown): boolean {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
    return true
  } catch { return false }
  finally { try { rmSync(temp, { force: true }) } catch { /* Preserve the original operation's outcome. */ } }
}
export function removeSessionData(path: string): boolean {
  try { rmSync(path, { force: true }); return true } catch { return false }
}
