import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { cacheClipboardImage, imageHelper, pasteClipboardImage, pngBytes } from '../src/attachments/clipboard-image.ts'
import { createTerminalService } from '../src/terminal/adapters/service.ts'
import { TerminalInputDecoder } from '../src/terminal/adapters/input.ts'
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
  const terminal = createTerminalService({ env: { DSH_TUI_TERMINAL: 'vscode' } })
  const shortcut = (sequence: string) => {
    const event = new TerminalInputDecoder().feed(sequence)[0]
    return event?.kind === 'key' && terminal.isImageShortcut(event.input, event.key)
  }
  expect(shortcut('\u001bv')).toBe(true)
  expect(shortcut('\u001bV')).toBe(true)
  expect(shortcut(String.fromCharCode(22))).toBe(true)
  expect(shortcut('v')).toBe(false)
})
it('deduplicates private images, bounds the cache and reports storage failure', () => {
  const home = root()
  const result = cacheClipboardImage(png, home)
  expect(result.kind).toBe('image')
  if (result.kind !== 'image') return
  // Windows stat mode does not represent POSIX owner/group permissions.
  if (process.platform !== 'win32') expect(statSync(result.path).mode & 0o777).toBe(0o600)
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
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: () => new Promise((done) => { resolve = done }) })
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
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: async () => ({ kind: 'image', path: '/tmp/meta-v.png' }) })
  try {
    await tty.send('\u001bv')
    expect(tty.screen()).toContain('Image 1')
    expect(tty.screen()).not.toContain('/tmp/meta-v.png')
  } finally { tty.unmount() }
})
it('keeps text intact when no image is available', async () => {
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: async () => ({ kind: 'empty' }) })
  try { await tty.send('keep draft'); await tty.send('\u0016'); expect(tty.screen()).toContain('keep draft'); expect(tty.screen()).toContain('No PNG image') }
  finally { tty.unmount() }
})

it('keeps typing and text paste responsive while a clipboard helper is pending', async () => {
  let finish!: (result: { kind: 'image'; path: string }) => void
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: () => new Promise((resolve) => { finish = resolve }) })
  try {
    await tty.send('before ')
    await tty.send('\u0016')
    await tty.send('during ')
    await tty.send('\u001b[200~pasted\u001b[201~')
    expect(tty.screen()).toContain('before during pasted')
    finish({ kind: 'image', path: '/tmp/late.png' })
    await tty.settle()
    expect(tty.screen()).toContain('before during pasted')
    expect(tty.screen()).toContain('Image 1')
  } finally { tty.unmount() }
})
it('cancels a pending image on Ctrl-C without restoring it into a new draft', async () => {
  let finish!: (result: { kind: 'image'; path: string }) => void
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: () => new Promise((resolve) => { finish = resolve }) })
  try {
    await tty.send('\u0016')
    await tty.send('\u0003')
    await tty.send('new draft')
    finish({ kind: 'image', path: '/tmp/stale.png' })
    await tty.settle()
    expect(tty.screen()).toContain('new draft')
    expect(tty.screen()).not.toContain('Image 1')
    expect(tty.screen()).not.toContain('again to exit')
  } finally { tty.unmount() }
})

it('ignores completion of a cancelled read while a newer image request is pending', async () => {
  const finishes: ((value: { kind: 'image'; path: string }) => void)[] = []
  const tty = await paintApp({ terminalProfile: 'apple', pasteImage: () => new Promise((resolve) => { finishes.push(resolve) }) })
  try {
    await tty.send('\u0016'); await tty.send('\u0003'); await tty.send('\u0016')
    finishes[0]({ kind: 'image', path: '/tmp/old.png' }); await tty.settle()
    await tty.send('\u0016')
    expect(finishes).toHaveLength(2)
    expect(tty.screen()).not.toContain('Image 1')
    finishes[1]({ kind: 'image', path: '/tmp/new.png' }); await tty.settle()
    expect(tty.screen()).toContain('Image 1')
  } finally { tty.unmount() }
})

it('repairs a corrupt clipboard image even when all cache slots are occupied', () => {
  const home = root()
  const first = cacheClipboardImage(png, home)
  if (first.kind !== 'image') throw Error('fixture cache failed')
  // Same size and valid magic: checking only file size/header is insufficient.
  const corrupt = Buffer.from(png)
  corrupt[20] ^= 1
  writeFileSync(first.path, corrupt)
  for (let i = 0; i < 63; i++) writeFileSync(join(home, 'tui-clipboard', `fixture-${i}`), '')
  expect(cacheClipboardImage(png, home)).toEqual(first)
  expect(readFileSync(first.path)).toEqual(png)
  expect(readdirSync(join(home, 'tui-clipboard'))).toHaveLength(64)
})

it.skipIf(process.platform === 'win32')('replaces a cache symlink without modifying its target', () => {
  const home = root()
  const result = cacheClipboardImage(png, home)
  if (result.kind !== 'image') throw Error('fixture cache failed')
  const outside = join(home, 'original.png')
  writeFileSync(outside, 'keep original')
  rmSync(result.path)
  symlinkSync(outside, result.path)
  expect(cacheClipboardImage(png, home)).toEqual(result)
  expect(readFileSync(result.path)).toEqual(png)
  expect(readFileSync(outside, 'utf8')).toBe('keep original')
})
