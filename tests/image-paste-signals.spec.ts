import { expect, it, vi } from 'vitest'
import { paintApp } from './fake-tty.ts'

it('imports an image on a completed empty terminal paste, without leaking its storage path', async () => {
  const read = vi.fn(async () => ({ kind: 'image' as const, path: '/tmp/hidden-cache.png' }))
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: read })
  try {
    await tty.send('my draft ')
    await tty.send('\u001b[200~\u001b[201~')
    expect(read).toHaveBeenCalledOnce()
    expect(tty.screen()).toContain('Image 1')
    expect(tty.screen()).toContain('my draft')
    expect(tty.screen()).not.toContain('/tmp/hidden-cache.png')
    await tty.send('\u001a'); expect(tty.screen()).not.toContain('Image 1')
    expect(tty.screen()).toContain('my draft')
  } finally { tty.unmount() }
})
it('waits for the final empty paste marker and handles split marker-only input', async () => {
  const read = vi.fn(async () => ({ kind: 'image' as const, path: '/tmp/split.png' }))
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: read })
  try {
    await tty.send('\u001b[200~'); expect(read).not.toHaveBeenCalled()
    await tty.send('\u001b[201~'); expect(read).toHaveBeenCalledOnce()
    expect(tty.screen()).toContain('Image 1')
  } finally { tty.unmount() }
})
it('keeps ordinary text paste intact and never reads the clipboard after nonempty fragmented paste', async () => {
  const read = vi.fn(async () => ({ kind: 'image' as const, path: '/tmp/unexpected.png' }))
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: read })
  try {
    await tty.send('\u001b[200~'); await tty.send('text\nsecond line'); await tty.send('\u001b[201~')
    expect(read).not.toHaveBeenCalled()
    expect(tty.screen()).toContain('second line'); expect(tty.screen()).not.toContain('Image 1')
  } finally { tty.unmount() }
})
it('does not create error noise for an empty clipboard paste; explicit Ctrl-V still explains it', async () => {
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: async () => ({ kind: 'empty' }) })
  try {
    await tty.send('\u001b[200~\u001b[201~'); expect(tty.screen()).not.toContain('No PNG image')
    await tty.send('\u0016'); expect(tty.screen()).toContain('No PNG image')
  } finally { tty.unmount() }
})

it('accepts a terminal-forwarded Meta-V image shortcut without exposing its cache path', async () => {
  const read = vi.fn(async () => ({ kind: 'image' as const, path: '/tmp/meta-cache.png' }))
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: read })
  try {
    // Ink represents a forwarded Command/Meta-V as ESC followed by `v`.
    await tty.send('\u001bv')
    expect(read).toHaveBeenCalledOnce()
    expect(tty.screen()).toContain('Image 1')
    expect(tty.screen()).not.toContain('/tmp/meta-cache.png')
  } finally { tty.unmount() }
})
