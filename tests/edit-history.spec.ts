import { expect, it } from 'vitest'
import { editorHistory, newEditorHistory } from '../src/prompt/edit-history.ts'

it('undoes text and cursor together, retains redo across motions, drops redo after a new edit', () => {
  let state = newEditorHistory({ text: 'first', cursor: 2 })
  state = editorHistory(state, { type: 'edit', snapshot: { text: 'fi!rst', cursor: 3 } })
  state = editorHistory(state, { type: 'undo' })
  expect(state.present).toEqual({ text: 'first', cursor: 2 })
  state = editorHistory(state, { type: 'cursor', cursor: 0 })
  state = editorHistory(state, { type: 'redo' })
  expect(state.present).toEqual({ text: 'fi!rst', cursor: 3 })
  state = editorHistory(state, { type: 'undo' })
  state = editorHistory(state, { type: 'edit', snapshot: { text: 'different', cursor: 9 } })
  expect(editorHistory(state, { type: 'redo' })).toBe(state)
})
it('groups fragmented paste into one undo operation and clears history at submission boundaries', () => {
  let state = newEditorHistory({ text: 'old', cursor: 3 })
  state = editorHistory(state, { type: 'begin' })
  state = editorHistory(state, { type: 'edit', snapshot: { text: 'old中', cursor: 4 } })
  state = editorHistory(state, { type: 'edit', snapshot: { text: 'old中文\ntext', cursor: 10 } })
  state = editorHistory(state, { type: 'end' })
  const undone = editorHistory(state, { type: 'undo' })
  expect(undone.present).toEqual({ text: 'old', cursor: 3 })
  expect(editorHistory(undone, { type: 'redo' }).present.text).toBe('old中文\ntext')
  const reset = editorHistory(state, { type: 'reset', snapshot: { text: '', cursor: 0 } })
  expect(editorHistory(reset, { type: 'undo' }).present.text).toBe('')
})
it('bounds history by operation count and text budget without mutating earlier states', () => {
  const initial = newEditorHistory({ text: '', cursor: 0 })
  let state = initial
  for (let i = 0; i < 150; i++) state = editorHistory(state, { type: 'edit', snapshot: { text: String(i), cursor: 0 } })
  expect(state.past.length).toBeLessThanOrEqual(100)
  expect(initial.present.text).toBe('')
  state = editorHistory(state, { type: 'edit', snapshot: { text: 'x'.repeat(5_000_000), cursor: 0 } })
  state = editorHistory(state, { type: 'edit', snapshot: { text: 'small', cursor: 0 } })
  expect(state.past).toHaveLength(0)
})
