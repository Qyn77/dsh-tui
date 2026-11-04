import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { imageSubmission, parseDraftImages } from '../src/attachments/draft-images.ts'
import { editorHistory, newEditorHistory } from '../src/prompt/edit-history.ts'
import { createDraftRepository } from '../src/terminal/drafts.ts'
import { findImageCandidates } from '../src/attachments/attachments.ts'
import { paintApp } from './fake-tty.ts'
const roots: string[] = []
function home() { const root = mkdtempSync(join(tmpdir(), 'dsh-draft-images-')); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('serializes attachments only at submission and validates private references', () => {
  const path = "/tmp/image with ' quotes.png"
  expect(findImageCandidates(imageSubmission('body', [{ path }]))[0].path).toBe(path)
  expect(parseDraftImages([{ path }])).toEqual([{ path }])
  expect(parseDraftImages([{ path: '../relative.png' }])).toBeUndefined()
  expect(parseDraftImages([{ path, name: 'bad\nname' }])).toBeUndefined()
  expect(parseDraftImages(Array.from({ length: 65 }, () => ({ path })))).toBeUndefined()
})
it('shares undo for body edits, attachment changes and text clearing', () => {
  let state = newEditorHistory({ text: 'body', cursor: 4 })
  state = editorHistory(state, { type: 'edit', snapshot: { ...state.present, images: [{ path: '/tmp/one.png' }] } })
  state = editorHistory(state, { type: 'edit', snapshot: { text: 'body!', cursor: 5 } })
  expect(state.present.images).toHaveLength(1)
  state = editorHistory(state, { type: 'undo' })
  expect(state.present.text).toBe('body'); expect(state.present.images).toHaveLength(1)
  state = editorHistory(state, { type: 'undo' })
  expect(state.present.images).toBeUndefined()
  expect(editorHistory(state, { type: 'redo' }).present.images).toHaveLength(1)
})
it('persists image-only drafts and clears them only after submission', async () => {
  const root = home(), store = createDraftRepository(root)
  const path = join(root, 'clipboard.png'); writeFileSync(path, 'image')
  const tty = await paintApp({ drafts: store, pasteImage: async () => ({ kind: 'image', path }) })
  await tty.send('\u0016'); tty.unmount()
  expect(store.open('tui-frame').load().draft).toMatchObject({ text: '', images: [{ path }] })
  const next = await paintApp({ drafts: store })
  try {
    expect(next.screen()).toContain('Image 1'); expect(next.screen()).not.toContain(path)
    await next.send('\r')
    expect(store.open('tui-frame').load()).toEqual({})
    expect(next.screen()).not.toContain('Ctrl-X removes')
  } finally { next.unmount() }
})
it('keeps pending images while running commands and editing the body externally', async () => {
  const root = home(), path = join(root, 'clipboard.png'); writeFileSync(path, 'image')
  const tty = await paintApp({ pasteImage: async () => ({ kind: 'image', path }), editExternally: async text => ({ kind: 'edited', text: text + 'edited body' }) })
  try {
    await tty.send('\u0016'); await tty.send('/status'); await tty.send('\r')
    expect(tty.screen()).toContain('Image 1')
    await tty.send('\u0014')
    expect(tty.screen()).toContain('edited body'); expect(tty.screen()).toContain('Image 1')
    expect(tty.screen()).not.toContain(path)
    await tty.send('\u0018'); expect(tty.screen()).not.toContain('Image 1')
    await tty.send('\u001a'); expect(tty.screen()).toContain('Image 1')
  } finally { tty.unmount() }
})
it('promotes pasted paths without adding a second undo step or leaking cache hashes', async () => {
  const root = home(), path = join(root, 'dragged.png'); writeFileSync(path, 'image')
  const tty = await paintApp()
  try {
    await tty.send(`\u001b[200~'${path}'\u001b[201~`); await tty.settle(200)
    expect(tty.screen()).toContain('dragged.png')
    expect(tty.screen()).not.toContain(root)
    await tty.send('\u001a'); await tty.settle(150)
    expect(tty.screen()).not.toContain('dragged.png')
    await tty.send('\u0019'); expect(tty.screen()).toContain('dragged.png')
  } finally { tty.unmount() }
})
it('Ctrl-C clears an image-only draft and remains undoable', async () => {
  const tty = await paintApp({ pasteImage: async () => ({ kind: 'image', path: '/tmp/clipboard-image.png' }) })
  try {
    await tty.send('\u0016'); expect(tty.screen()).toContain('Image 1')
    await tty.send('\u0003'); expect(tty.screen()).not.toContain('Image 1')
    await tty.send('\u001a'); expect(tty.screen()).toContain('Image 1')
  } finally { tty.unmount() }
})
