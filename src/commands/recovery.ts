import { userMessageText, type UiState } from '../core/types.ts'

export interface RecoveryPlan { text: string; completed: string[]; reason: string }

/** Inspect committed outcomes; recovery never directly re-executes a tool. */
export function recoveryPlan(state: UiState): RecoveryPlan | undefined {
  if (state.status !== 'idle' || !state.lastReason || state.lastReason.kind === 'completed') return undefined
  const task = state.tasks?.at(-1)
  const entries = task ? state.entries.slice(task.startIndex, task.endIndex) : state.entries
  let text: string | undefined
  for (const entry of entries) if (entry.kind === 'user') text = userMessageText(entry.message)
  if (text === undefined) return undefined
  const completed = entries.flatMap(entry => entry.kind !== 'tool' ? [] : [
    ...(entry.status === 'ok' ? [entry.name] : []),
    ...(entry.subCalls?.filter(call => call.status === 'ok').map(call => call.name) ?? []),
  ])
  return { text, completed, reason: state.lastReason.kind }
}
