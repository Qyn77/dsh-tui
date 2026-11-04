import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createDraftRepository, parseDraft } from '../src/terminal/drafts.ts'

const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
function root(): string { const path = mkdtempSync(join(tmpdir(), 'dsh-drafts-')); roots.push(path); return path }

it('validates ownership, bounds and a safe Unicode cursor', () => {
  expect(parseDraft({ version: 1, session: 'a', text: '中😀文', cursor: 2 }, 'a')).toEqual({ text: '中😀文', cursor: 1 })
  expect(parseDraft({ version: 1, session: 'b', text: 'secret', cursor: 0 }, 'a')).toBeUndefined()
  expect(parseDraft({ version: 1, session: 'a', text: 3, cursor: 0 }, 'a')).toBeUndefined()
})
it('atomically saves independent private drafts and clears a submitted draft', () => {
  const home = root()
  const store = createDraftRepository(home)
  const first = store.open('../first')
  const second = store.open('second')
  expect(first.load()).toEqual({})
  expect(first.save({ text: 'draft\n./screen.png', cursor: 5 })).toBe(true)
  expect(second.save({ text: 'other', cursor: 5 })).toBe(true)
  expect(createDraftRepository(home).open('../first').load().draft).toEqual({ text: 'draft\n./screen.png', cursor: 5 })
  const names = readdirSync(join(home, 'tui-drafts'))
  expect(names).toHaveLength(2)
  for (const name of names) expect(statSync(join(home, 'tui-drafts', name)).mode & 0o777).toBe(0o600)
  expect(first.save({ text: '', cursor: 0 })).toBe(true)
  expect(first.load()).toEqual({})
  expect(second.load().draft?.text).toBe('other')
})
it('reports corruption and write failures without leaking draft content', () => {
  const home = root()
  const channel = createDraftRepository(home).open('a')
  channel.save({ text: 'draft', cursor: 5 })
  const file = join(home, 'tui-drafts', readdirSync(join(home, 'tui-drafts'))[0])
  writeFileSync(file, '{broken')
  expect(channel.load()).toEqual({ failed: true })
  expect(readFileSync(file, 'utf8')).toBe('{broken')
  writeFileSync(join(home, 'blocked'), 'not a directory')
  expect(createDraftRepository(join(home, 'blocked')).open('a').save({ text: 'text', cursor: 0 })).toBe(false)
})

it('flushes on unmount, restores the cursor and clears on submission', async () => {
  const { paintApp } = await import('./fake-tty.ts')
  const store = createDraftRepository(root())
  const tty = await paintApp({ drafts: store })
  await tty.send('draft long')
  await tty.send('\u001b[D')
  tty.unmount()
  expect(store.open('tui-frame').load().draft).toEqual({ text: 'draft long', cursor: 9 })
  const resumed = await paintApp({ drafts: store })
  try {
    expect(resumed.screen()).toContain('draft lon')
    await resumed.send('!')
    expect(resumed.screen()).toContain('draft lon!')
    await resumed.send('\r')
    expect(store.open('tui-frame').load()).toEqual({})
  } finally { resumed.unmount() }
})
it('keeps the original draft while the session chooser opens and cancels', async () => {
  const { paintApp } = await import('./fake-tty.ts')
  const store = createDraftRepository(root())
  const tty = await paintApp({ drafts: store })
  try {
    await tty.send('keep this input')
    await tty.send('\u0007')
    expect(tty.screen()).toContain('/sessions ')
    await tty.settle(250)
    expect(store.open('tui-frame').load().draft?.text).toBe('keep this input')
    await tty.send('\u001b')
    expect(tty.screen()).toContain('keep this input')
  } finally { tty.unmount() }
})
