/** One editor history for all prompt editing paths; clocks and I/O stay outside. */
export interface EditSnapshot { text: string; cursor: number }
export interface EditorHistory {
  present: EditSnapshot
  past: readonly EditSnapshot[]
  future: readonly EditSnapshot[]
  grouping: boolean
  grouped: boolean
}
export type EditorAction =
  | { type: 'edit' | 'reset'; snapshot: EditSnapshot }
  | { type: 'cursor'; cursor: number }
  | { type: 'begin' | 'end' | 'undo' | 'redo' }

function safe(snapshot: EditSnapshot): EditSnapshot {
  return { text: snapshot.text, cursor: Math.max(0, Math.min(snapshot.cursor, snapshot.text.length)) }
}
export function newEditorHistory(snapshot: EditSnapshot): EditorHistory {
  return { present: safe(snapshot), past: [], future: [], grouping: false, grouped: false }
}
function bounded(state: EditorHistory): EditorHistory {
  const past = [...state.past]
  const future = [...state.future]
  let bytes = [...past, ...future].reduce((sum, item) => sum + item.text.length * 2, 0)
  while (past.length + future.length > 100 || bytes > 8 * 1024 * 1024) {
    const removed = past.length ? past.shift() : future.shift()
    if (!removed) break
    bytes -= removed.text.length * 2
  }
  return { ...state, past, future }
}
export function editorHistory(state: EditorHistory, action: EditorAction): EditorHistory {
  switch (action.type) {
    case 'reset': return newEditorHistory(action.snapshot)
    case 'cursor': {
      const cursor = safe({ ...state.present, cursor: action.cursor }).cursor
      return cursor === state.present.cursor ? state : { ...state, present: { ...state.present, cursor } }
    }
    case 'begin': return { ...state, grouping: true, grouped: false }
    case 'end': return { ...state, grouping: false, grouped: false }
    case 'edit': {
      const present = safe(action.snapshot)
      if (present.text === state.present.text) return editorHistory(state, { type: 'cursor', cursor: present.cursor })
      return bounded({ ...state, present, future: [],
        past: state.grouping && state.grouped ? state.past : [...state.past, state.present], grouped: state.grouping })
    }
    case 'undo': {
      const present = state.past.at(-1)
      return present ? bounded({ ...state, present, past: state.past.slice(0, -1), future: [...state.future, state.present],
        grouping: false, grouped: false }) : state
    }
    case 'redo': {
      const present = state.future.at(-1)
      return present ? bounded({ ...state, present, past: [...state.past, state.present], future: state.future.slice(0, -1),
        grouping: false, grouped: false }) : state
    }
  }
}
