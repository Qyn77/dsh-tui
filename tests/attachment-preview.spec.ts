import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { previewImages, removePreview } from '../src/attachments/preview.ts'
import { paintApp } from './fake-tty.ts'

it('previews existing image metadata and removes only its exact buffer range', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preview-'))
  try {
    await writeFile(join(root, 'one pic.png'), 'bytes')
    const text = 'first\n"one pic.png"\nlast missing.png'
    const previews = await previewImages(text, root)
    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({ bytes: 5, name: 'one pic.png' })
    expect(removePreview(text, previews[0]).text).toBe('first\n\nlast missing.png')
  } finally { await rm(root, { recursive: true, force: true }) }
})
it('shows a draft attachment and removes it from the live input with Ctrl-X', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-preview-frame-'))
  const tty = await paintApp({ rows: 40 })
  try {
    const path = join(root, 'preview.png')
    await writeFile(path, 'bytes')
    await tty.send(path)
    await tty.settle(200)
    expect(tty.screen()).toContain('1 image')
    expect(tty.screen()).toContain('preview.png')
    await tty.send('\u0018')
    expect(tty.screen()).not.toContain('preview.png')
  } finally { tty.unmount(); await rm(root, { recursive: true, force: true }) }
})
