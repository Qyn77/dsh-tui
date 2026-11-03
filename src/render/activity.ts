/** Completed task disclosure is a view projection, never a session mutation. */
import type { TaskRun, UiEntry, UiState } from '../core/types.ts'

function taskEntries(entries: UiEntry[], task: TaskRun, expanded: boolean): UiEntry[] {
  if (task.endIndex === undefined) return entries
  let final = -1
  entries.forEach((entry, index) => {
    if ((entry.kind === 'assistant' && entry.turn === task.turn && entry.text.trim() !== '') || entry.kind === 'tool') final = index
  })
  const isDetail = (entry: UiEntry, index: number): boolean => index !== final
    && entry.kind !== 'user' && entry.kind !== 'command' && entry.kind !== 'activity'
    && !(entry.kind === 'note' && entry.tone !== undefined)
    && !(entry.kind === 'hook' && entry.status === 'cancelled')
    && !(entry.kind === 'tool' && (entry.status === 'error' || entry.status === 'cancelled'))
    && !(entry.kind === 'approval' && entry.status === 'running')
  const last = entries[final]
  const count = entries.filter(isDetail).length + (last?.kind === 'assistant' && last.reasoning ? 1 : 0)
  const durationMs = task.startedAt !== undefined && task.endedAt !== undefined
    ? Math.max(0, task.endedAt - task.startedAt) : undefined
  const summary: UiEntry = { kind: 'activity', turn: task.turn, count, expanded, durationMs,
    outcome: task.outcome ?? 'interrupted' }
  let disclosed = false
  const visible = entries.flatMap((entry, index) => {
    if (index === final) {
      const heading = disclosed ? [] : [summary]
      disclosed = true
      return [...heading, entry.kind === 'assistant' && entry.reasoning ? { ...entry, reasoningVisible: expanded } : entry]
    }
    if (!isDetail(entry, index)) return [entry]
    const heading = disclosed ? [] : [summary]
    disclosed = true
    return [...heading, ...(expanded ? [entry] : [])]
  })
  return disclosed || entries.length === 0 ? visible : [summary, ...visible]
}

export function activityView(state: UiState, expanded: ReadonlySet<number>): UiState {
  if (!state.tasks?.length) return state
  const entries: UiEntry[] = []
  let cursor = 0
  for (const task of state.tasks) {
    if (task.endIndex === undefined) continue
    const start = Math.max(cursor, task.startIndex)
    const end = Math.min(state.entries.length, task.endIndex)
    entries.push(...state.entries.slice(cursor, start))
    entries.push(...taskEntries(state.entries.slice(start, end), task, expanded.has(task.turn)))
    cursor = end
  }
  entries.push(...state.entries.slice(cursor))
  return { ...state, entries }
}
