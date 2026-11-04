import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createSessionLibrary } from '../src/terminal/session-library.ts'
import { sessionPickerQuery } from '../src/commands/session-picker.ts'

const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
function root(): string { const path = mkdtempSync(join(tmpdir(), 'dsh-library-')); roots.push(path); return path }

it('persists independent names, favorites and archive flags without touching session logs', () => {
  const home = root()
  const library = createSessionLibrary(home)
  expect(library.update('a', { title: '项目迁移', favorite: true })).toBe(true)
  expect(library.update('a', { archived: true })).toBe(true)
  expect(library.update('b', { title: 'other' })).toBe(true)
  expect(createSessionLibrary(home).read('a')).toEqual({ metadata: { title: '项目迁移', favorite: true, archived: true } })
  expect(library.update('a', { title: null })).toBe(true)
  expect(library.read('a').metadata).toEqual({ favorite: true, archived: true })
  expect(library.read('b').metadata.title).toBe('other')
})
it('rejects terminal control characters, overwide titles and corrupt metadata updates', () => {
  const home = root()
  const library = createSessionLibrary(home)
  expect(library.update('a', { title: 'bad\u001b[2J' })).toBe(false)
  expect(library.update('a', { title: '中'.repeat(61) })).toBe(false)
  library.update('a', { title: 'good' })
  const path = join(home, 'tui-sessions', readdirSync(join(home, 'tui-sessions'))[0])
  writeFileSync(path, '{broken')
  expect(library.read('a').failed).toBe(true)
  expect(library.update('a', { favorite: true })).toBe(false)
  expect(readFileSync(path, 'utf8')).toBe('{broken')
})
it('reserves management commands and resume-last instead of accidentally selecting a filtered session', () => {
  expect(sessionPickerQuery('/sessions 项目')).toBe('项目')
  expect(sessionPickerQuery('/sessions rename current 新标题')).toBeUndefined()
  expect(sessionPickerQuery('/sessions all')).toBeUndefined()
  expect(sessionPickerQuery('/sessions archived')).toBeUndefined()
  expect(sessionPickerQuery('/resume last')).toBeUndefined()
  expect(sessionPickerQuery('/resume tui-12345678')).toBe('tui-12345678')
})

it('dispatches management syntax through the prompt instead of picker activation', async () => {
  const { paintApp } = await import('./fake-tty.ts')
  const { vi } = await import('vitest')
  const update = vi.fn().mockReturnValue(true)
  const tty = await paintApp({ sessionLibrary: { read: () => ({ metadata: {} }), update } })
  try {
    await tty.send('/sessions rename current My title'); await tty.send('\r')
    expect(update).toHaveBeenCalledWith('tui-frame', { title: 'My title' })
    expect(tty.screen()).toContain('Updated session labels')
  } finally { tty.unmount() }
})
