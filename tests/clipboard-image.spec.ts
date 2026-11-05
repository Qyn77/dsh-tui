import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { cacheClipboardImage, imageHelper, pasteClipboardImage, pngBytes } from '../src/attachments/clipboard-image.ts'
import { isClipboardImageShortcut } from '../src/prompt/paste.ts'
import { paintApp } from './fake-tty.ts'
const roots: string[] = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
function root(): string { const path = mkdtempSync(join(tmpdir(), 'dsh-clipboard-')); roots.push(path); return path }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
it('selects fixed native commands and validates binary/base64 boundaries', () => {
  expect(imageHelper('darwin', {})?.file).toBe('/usr/bin/osascript')
  expect(imageHelper('linux', { WAYLAND_DISPLAY: 'a', DISPLAY: 'b' })?.file).toBe('wl-paste')
  expect(imageHelper('linux', { DISPLAY: 'b' })?.args).toContain('image/png')
  expect(imageHelper('linux', {})).toBeUndefined()
  expect(pngBytes(Buffer.from(png.toString('base64')), true)).toEqual(png)
  expect(pngBytes(Buffer.from('not a png'), false)).toBeUndefined()
  expect(pngBytes(Buffer.from('!!!!'), true)).toBeUndefined()
  expect(pngBytes(Buffer.alloc(17 * 1024 * 1024), false)).toBeUndefined()
})
it('recognises forwarded Command-V forms without treating plain text as an image shortcut', () => {
  expect(isClipboardImageShortcut('v', { meta: true })).toBe(true)
  expect(isClipboardImageShortcut('V', { meta: true })).toBe(true)
  expect(isClipboardImageShortcut('\u001bv')).toBe(true)
  expect(isClipboardImageShortcut(String.fromCharCode(22))).toBe(true)
  expect(isClipboardImageShortcut('v')).toBe(false)
})
it('deduplicates private images, bounds the cache and reports storage failure', () => {
  const home = root()
  const result = cacheClipboardImage(png, home)
  expect(result.kind).toBe('image')
  if (result.kind !== 'image') return
  expect(statSync(result.path).mode & 0o777).toBe(0o600)
  expect(cacheClipboardImage(png, home)).toEqual(result)
  expect(readdirSync(join(home, 'tui-clipboard'))).toHaveLength(1)
  for (let i = 0; i < 63; i++) writeFileSync(join(home, 'tui-clipboard', `fixture-${i}`), '')
  expect(cacheClipboardImage(Buffer.concat([png, Buffer.from('different')]), home)).toEqual({ kind: 'full' })
  writeFileSync(join(home, 'blocked'), '')
  expect(cacheClipboardImage(png, join(home, 'blocked')).kind).toBe('failed')
})
it('runs a helper without a shell and handles empty, missing and invalid output', async () => {
  const home = root()
  const helper = (code: string) => ({ file: process.execPath, args: ['-e', code], base64: true })
  expect((await pasteClipboardImage(home, helper(`process.stdout.write('${png.toString('base64')}')`))).kind).toBe('image')
  expect(await pasteClipboardImage(home, helper(''))).toEqual({ kind: 'empty' })
  expect(await pasteClipboardImage(home, helper("process.stdout.write('bad')"))).toEqual({ kind: 'failed' })
  expect(await pasteClipboardImage(home, { file: '/missing-dsh-helper', args: [], base64: false })).toEqual({ kind: 'unavailable' })
})
it('inserts an image as one undoable edit; pending reads cannot submit half an attachment', async () => {
  let resolve!: (result: { kind: 'image'; path: string }) => void
  const tty = await paintApp({ pasteImage: () => new Promise((done) => { resolve = done }) })
  try {
    await tty.send('draft')
    await tty.send('\u0016')
    await tty.send('\r')
    expect(tty.screen()).toContain('draft')
    resolve({ kind: 'image', path: '/tmp/qa screen.png' })
    await tty.settle()
    expect(tty.screen()).toContain('Image 1')
    expect(tty.screen()).not.toContain('/tmp/qa screen.png')
    await tty.send('\u001a')
    expect(tty.screen()).not.toContain('Image 1')
    expect(tty.screen()).toContain('draft')
    await tty.send('\u0019')
    expect(tty.screen()).toContain('Image 1')
    expect(tty.screen()).not.toContain('/tmp/qa screen.png')
  } finally { tty.unmount() }
})
it('accepts a terminal-forwarded Meta-V image shortcut', async () => {
  const tty = await paintApp({ pasteImage: async () => ({ kind: 'image', path: '/tmp/meta-v.png' }) })
  try {
    await tty.send('\u001bv')
    expect(tty.screen()).toContain('Image 1')
    expect(tty.screen()).not.toContain('/tmp/meta-v.png')
  } finally { tty.unmount() }
})
it('keeps text intact when no image is available', async () => {
  const tty = await paintApp({ pasteImage: async () => ({ kind: 'empty' }) })
  try { await tty.send('keep draft'); await tty.send('\u0016'); expect(tty.screen()).toContain('keep draft'); expect(tty.screen()).toContain('No PNG image') }
  finally { tty.unmount() }
})
