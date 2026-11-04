import { useCallback, useRef, useState } from 'react'
import { editorHistory, newEditorHistory, type EditSnapshot, type EditorAction, type EditorHistory } from '../prompt/edit-history.ts'
import { insertTextAtCursor, removeCharBeforeCursor } from '../prompt/prompt-editing.ts'

export function useEditorHistory(initial: EditSnapshot) {
  const [state, setState] = useState(() => newEditorHistory(initial))
  const current = useRef(state)
  const apply = useCallback((action: EditorAction) => {
    const next = editorHistory(current.current, action)
    current.current = next
    setState(next)
  }, [])
  const change = useCallback((update: (snapshot: EditSnapshot) => EditSnapshot) => {
    apply({ type: 'edit', snapshot: update(current.current.present) })
  }, [apply])
  const setValue = useCallback((text: string) => {
    apply({ type: 'edit', snapshot: { text, cursor: current.current.present.cursor } })
  }, [apply])
  const setCursorIndex = useCallback((cursor: number | ((value: number) => number)) => {
    apply({ type: 'cursor', cursor: typeof cursor === 'function' ? cursor(current.current.present.cursor) : cursor })
  }, [apply])
  const insert = useCallback((text: string) => {
    const value = current.current.present
    apply({ type: 'edit', snapshot: { text: insertTextAtCursor(value.text, value.cursor, text), cursor: value.cursor + text.length } })
  }, [apply])
  const backspace = useCallback(() => {
    const value = current.current.present
    apply({ type: 'edit', snapshot: { text: removeCharBeforeCursor(value.text, value.cursor), cursor: value.cursor - 1 } })
  }, [apply])
  const restore = useCallback((saved: EditorHistory) => { current.current = saved; setState(saved) }, [])
  return { state, value: state.present.text, cursorIndex: state.present.cursor,
    setValue, setCursorIndex, insert, backspace, apply, restore, change }
}
