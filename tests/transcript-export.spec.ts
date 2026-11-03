import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { exportTranscript } from '../src/commands/transcript-export.ts'

it('exports Markdown to the requested directory and refuses to overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-export-'))
  try {
    const path = await exportTranscript('notes.md', root, [{ kind: 'note', text: 'complete text' }])
    expect(path).toBe(join(root, 'notes.md'))
    expect(await readFile(path, 'utf8')).toContain('complete text')
    await expect(exportTranscript('notes.md', root, [{ kind: 'note', text: 'overwritten' }])).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path, 'utf8')).not.toContain('overwritten')
  } finally { await rm(root, { recursive: true, force: true }) }
})
