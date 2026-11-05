import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink, lstat, realpath, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'

const LIMIT = 1024 * 1024
export interface FileSnapshot { data: string; mode: number }
export interface Checkpoint { id: string; path: string; before: FileSnapshot | null; after?: FileSnapshot | null; restored?: boolean }
export type CheckpointFailure = 'invalid' | 'unsafe' | 'large' | 'unsealed' | 'conflict' | 'sealed' | 'locked'
export class CheckpointError extends Error {
  constructor(readonly code: CheckpointFailure) { super(code); this.name = 'CheckpointError' }
}
function validSnapshot(value: unknown): value is FileSnapshot | null {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const s = value as FileSnapshot
  return typeof s.data === 'string' && s.data.length <= Math.ceil(LIMIT / 3) * 4
    && Buffer.from(s.data, 'base64').toString('base64') === s.data
    && Number.isInteger(s.mode) && s.mode >= 0 && s.mode <= 0o777
}
async function snapshot(path: string): Promise<FileSnapshot | null> {
  try {
    const st = await lstat(path)
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new CheckpointError('unsafe')
    if (st.size > LIMIT) throw new CheckpointError('large')
    const bytes = await readFile(path)
    if (bytes.length > LIMIT) throw new CheckpointError('large')
    const next = await lstat(path)
    if (st.ino !== next.ino || st.mtimeMs !== next.mtimeMs || st.size !== next.size) throw new CheckpointError('conflict')
    return { data: bytes.toString('base64'), mode: st.mode & 0o777 }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
function equal(a: FileSnapshot | null, b: FileSnapshot | null) {
  return a === null || b === null ? a === b : a.data === b.data && a.mode === b.mode
}
export function checkpointRepository(cwd: string, home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')) {
  const root = resolve(cwd)
  const namespace = createHash('sha256').update(root).digest('hex')
  const directory = join(home, 'tui-checkpoints', namespace)
  const recordPath = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new CheckpointError('invalid')
    return join(directory, `${id}.json`)
  }
  const safePath = async (path: string) => {
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(path)) throw new CheckpointError('unsafe')
    const target = resolve(root, path)
    const rel = relative(root, target)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new CheckpointError('unsafe')
    const realRoot = await realpath(root)
    const parent = await realpath(dirname(target))
    const parentRelative = relative(realRoot, parent)
    if (parentRelative.startsWith('..') || isAbsolute(parentRelative)) throw new CheckpointError('unsafe')
    // Reject links even when they resolve back into the workspace.
    if (parent !== resolve(realRoot, relative(root, dirname(target)))) throw new CheckpointError('unsafe')
    return target
  }
  const read = async (id: string): Promise<Checkpoint> => {
    const file = recordPath(id)
    if ((await lstat(file)).size > LIMIT * 3) throw new CheckpointError('large')
    const item = JSON.parse(await readFile(file, 'utf8')) as Checkpoint
    if (item.id !== id || typeof item.path !== 'string' || !validSnapshot(item.before)
      || (item.after !== undefined && !validSnapshot(item.after))) throw new CheckpointError('invalid')
    await safePath(item.path)
    return item
  }
  const update = async (item: Checkpoint) => {
    const temporary = join(directory, `${randomUUID()}.tmp`)
    try { await writeFile(temporary, JSON.stringify(item), { flag: 'wx', mode: 0o600 }); await rename(temporary, recordPath(item.id)) }
    finally { await unlink(temporary).catch(() => {}) }
  }
  const locked = async <T>(id: string, action: () => Promise<T>) => {
    const lock = recordPath(id) + '.lock'
    try { await writeFile(lock, '', { flag: 'wx', mode: 0o600 }) }
    catch { throw new CheckpointError('locked') }
    try { return await action() } finally { await unlink(lock) }
  }
  return {
    read,
    async save(path: string): Promise<Checkpoint> {
      const target = await safePath(path)
      const item: Checkpoint = { id: randomUUID(), path: relative(root, target), before: await snapshot(target) }
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(recordPath(item.id), JSON.stringify(item), { flag: 'wx', mode: 0o600 })
      return item
    },
    async list(): Promise<Checkpoint[]> {
      const { readdir } = await import('node:fs/promises')
      let names: string[]
      try { names = await readdir(directory) } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw error
      }
      const result: Checkpoint[] = []
      for (const name of names.sort()) if (name.endsWith('.json')) {
        try { result.push(await read(name.slice(0, -5))) } catch { /* A damaged record never becomes a restoration target. */ }
      }
      return result
    },
    seal(id: string) {
      return locked(id, async () => {
        const item = await read(id)
        if (item.after !== undefined) throw new CheckpointError('sealed')
        item.after = await snapshot(await safePath(item.path))
        await update(item)
        return item
      })
    },
    restore(id: string) {
      return locked(id, async () => {
        const item = await read(id)
        if (item.after === undefined) throw new CheckpointError('unsealed')
        const target = await safePath(item.path)
        if (!equal(await snapshot(target), item.after)) throw new CheckpointError('conflict')
        if (item.before === null) {
          if (item.after !== null) await unlink(target)
        } else if (item.after === null) {
          await writeFile(target, Buffer.from(item.before.data, 'base64'), { flag: 'wx', mode: item.before.mode })
          await chmod(target, item.before.mode)
        } else {
          const temporary = join(dirname(target), `.dsh-restore-${randomUUID()}`)
          try {
            await writeFile(temporary, Buffer.from(item.before.data, 'base64'), { flag: 'wx', mode: item.before.mode })
            await chmod(temporary, item.before.mode)
            if (!equal(await snapshot(target), item.after)) throw new CheckpointError('conflict')
            await rename(temporary, target)
          } finally { await unlink(temporary).catch(() => {}) }
        }
        item.restored = true
        await update(item)
        return item
      })
    },
  }
}
