import { expect, it, vi } from 'vitest'
import { paintApp } from './fake-tty.ts'

function input(screen: string): string { return screen.slice(screen.lastIndexOf('╭')) }

it('shares undo/redo across readline deletion and new typing', async () => {
  const tty = await paintApp()
  try {
    await tty.send('alpha beta')
    await tty.send('\u0017')
    expect(input(tty.screen())).not.toContain('beta')
    await tty.send('\u001a')
    expect(input(tty.screen())).toContain('alpha beta')
    await tty.send('\u0019')
    expect(input(tty.screen())).not.toContain('beta')
    await tty.send('\u001a')
    await tty.send('!')
    await tty.send('\u0019')
    expect(input(tty.screen())).toContain('alpha beta!')
  } finally { tty.unmount() }
})
it('undoes a fragmented multiline paste as one operation', async () => {
  const tty = await paintApp()
  try {
    await tty.send('before ')
    await tty.send('\u001b[200~中文\n')
    await tty.send('second line')
    await tty.send('\u001b[201~')
    await tty.send('\u001a')
    expect(input(tty.screen())).toContain('before ')
    expect(input(tty.screen())).not.toContain('second line')
    await tty.send('\u0012')
    expect(input(tty.screen())).toContain('中文')
    expect(input(tty.screen())).toContain('second line')
  } finally { tty.unmount() }
})
it('uses the same history for Vim edits, u, Ctrl-R and readline edits', async () => {
  const tty = await paintApp({ keybinds: 'vim' })
  try {
    await tty.send('alpha beta')
    await tty.send('\u001b'); await tty.send('0'); await tty.send('d'); await tty.send('w')
    expect(input(tty.screen())).not.toContain('alpha')
    await tty.send('u')
    expect(input(tty.screen())).toContain('alpha beta')
    await tty.send('\u0012')
    expect(input(tty.screen())).not.toContain('alpha')
    await tty.send('i'); await tty.send('\u0005'); await tty.send('\u0017')
    expect(input(tty.screen())).not.toContain('beta')
    await tty.send('\u001a')
    expect(input(tty.screen())).toContain('beta')
  } finally { tty.unmount() }
})
it('never undoes a submission into a duplicate request', async () => {
  const followup = vi.fn()
  const tty = await paintApp({ followup })
  try {
    await tty.send('do once'); await tty.send('\r'); await tty.send('\u001a')
    expect(input(tty.screen())).not.toContain('do once')
    expect(followup).toHaveBeenCalledOnce()
  } finally { tty.unmount() }
})
it('returns from the session chooser with the original edit history', async () => {
  const tty = await paintApp()
  try {
    await tty.send('first'); await tty.send(' second')
    await tty.send('\u0007'); await tty.send('\u001b'); await tty.send('\u001a')
    expect(input(tty.screen())).toContain('first')
    expect(input(tty.screen())).not.toContain('second')
  } finally { tty.unmount() }
})
