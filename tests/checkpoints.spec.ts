import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile, readFile, rm, unlink, symlink, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkpointRepository } from '../src/terminal/checkpoints.ts'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-')); roots.push(root)
  return { root, file: join(root, 'work.txt'), repo: checkpointRepository(root, join(root, 'store')) }
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
describe('selective file checkpoints', () => {
  it('previews and restores a sealed file with modes and durable snapshots', async () => {
    const { file, repo } = await fixture()
    await writeFile(file, 'before', { mode: 0o640 })
    const item = await repo.save('work.txt')
    await expect(repo.restore(item.id)).rejects.toMatchObject({ code: 'unsealed' })
    await writeFile(file, 'after')
    await repo.seal(item.id)
    await expect(repo.seal(item.id)).rejects.toMatchObject({ code: 'sealed' })
    await repo.restore(item.id)
    expect(await readFile(file, 'utf8')).toBe('before')
    expect((await stat(file)).mode & 0o777).toBe(0o640)
    expect((await repo.read(item.id)).after?.data).toBe(Buffer.from('after').toString('base64'))
    expect(await repo.list()).toHaveLength(1)
  })
  it('refuses edits made after sealing without touching them', async () => {
    const { file, repo } = await fixture()
    await writeFile(file, 'before'); const item = await repo.save('work.txt')
    await writeFile(file, 'model'); await repo.seal(item.id)
    await writeFile(file, 'user changes')
    await expect(repo.restore(item.id)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(file, 'utf8')).toBe('user changes')
  })
  it('restores creation and deletion without silently replacing new files', async () => {
    const { file, repo } = await fixture()
    const created = await repo.save('work.txt')
    await writeFile(file, 'new'); await repo.seal(created.id); await repo.restore(created.id)
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(file, 'original'); const deleted = await repo.save('work.txt')
    await unlink(file); await repo.seal(deleted.id)
    await writeFile(file, 'other writer')
    await expect(repo.restore(deleted.id)).rejects.toMatchObject({ code: 'conflict' })
    await unlink(file); await repo.restore(deleted.id)
    expect(await readFile(file, 'utf8')).toBe('original')
  })
  it('refuses traversal, symlinks, special files, oversized data and invalid ids', async () => {
    const { root, file, repo } = await fixture()
    await expect(repo.save('../escape.txt')).rejects.toMatchObject({ code: 'unsafe' })
    await writeFile(file, 'private'); await symlink(file, join(root, 'link.txt'))
    await expect(repo.save('link.txt')).rejects.toMatchObject({ code: 'unsafe' })
    await mkdir(join(root, 'store'))
    await expect(repo.save('store')).rejects.toMatchObject({ code: 'unsafe' })
    await writeFile(file, Buffer.alloc(1024 * 1024 + 1))
    await expect(repo.save('work.txt')).rejects.toMatchObject({ code: 'large' })
    await expect(repo.read('../../escape')).rejects.toMatchObject({ code: 'invalid' })
  })
})

it('requires explicit confirmation before restoring through the command handler', async () => {
  const { checkpointCommand } = await import('../src/commands/checkpoints.ts')
  const { catalog } = await import('../src/core/i18n.ts')
  const { vi } = await import('vitest')
  const { root, file, repo } = await fixture()
  vi.stubEnv('DSH_HOME', join(root, 'store'))
  try {
    await writeFile(file, 'original'); const item = await repo.save('work.txt')
    await writeFile(file, 'changed'); await repo.seal(item.id)
    const preview = await checkpointCommand(`/checkpoint restore ${item.id}`, root, catalog('en').checkpoint, false)
    expect(preview.message).toContain('confirm')
    expect(await readFile(file, 'utf8')).toBe('changed')
    const result = await checkpointCommand(`/checkpoint restore ${item.id} confirm`, root, catalog('en').checkpoint, false)
    expect(result.failed).not.toBe(true)
    expect(await readFile(file, 'utf8')).toBe('original')
  } finally { vi.unstubAllEnvs() }
})

it('keeps binary bytes lossless without emitting terminal controls in previews', async () => {
  const { checkpointCommand } = await import('../src/commands/checkpoints.ts')
  const { catalog } = await import('../src/core/i18n.ts')
  const { vi } = await import('vitest')
  const { root, file, repo } = await fixture()
  vi.stubEnv('DSH_HOME', join(root, 'store'))
  try {
    const bytes = Buffer.from([0, 255, 27, 93, 53, 50])
    await writeFile(file, bytes); const item = await repo.save('work.txt')
    await writeFile(file, 'changed'); await repo.seal(item.id)
    const report = await checkpointCommand(`/checkpoint show ${item.id}`, root, catalog('en').checkpoint, false)
    expect(report.message).toContain('text preview is unavailable')
    expect(report.message).not.toContain('\u001b')
    await repo.restore(item.id)
    expect(await readFile(file)).toEqual(bytes)
    await expect(repo.save('bad\u001b.png')).rejects.toMatchObject({ code: 'unsafe' })
  } finally { vi.unstubAllEnvs() }
})
