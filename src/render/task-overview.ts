import type { UiEntry } from '../core/types.ts'
import { recordedDiffs } from './file-diffs.ts'

function lines(text: string): string[] {
  if (!text) return []
  const result = text.split('\n')
  if (result.at(-1) === '') result.pop()
  return result
}

/** Exact LCS line counts within a bounded work budget; no guessed fallback. */
export function lineDelta(before: string | null, after: string): { added: number; removed: number } | undefined {
  if (before === null) return undefined
  if (before === after) return { added: 0, removed: 0 }
  const a = lines(before)
  const b = lines(after)
  if (a.length + b.length > 20_000 || a.length * b.length > 1_000_000) return undefined
  const row = new Uint32Array(b.length + 1)
  for (const left of a) {
    let diagonal = 0
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j]
      row[j] = left === b[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1])
      diagonal = previous
    }
  }
  const common = row[b.length]
  return { added: b.length - common, removed: a.length - common }
}

export interface TaskOverview {
  files: Array<{ path: string; edits: number; added?: number; removed?: number }>
  commands: Array<{ command: string; outcome: string; entry: number }>
}

function commandText(args: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(args)
    if (!parsed || typeof parsed !== 'object') return undefined
    for (const key of ['command', 'cmd'] as const) {
      if (key in parsed) {
        const value = (parsed as Record<string, unknown>)[key]
        if (typeof value === 'string') return value
      }
    }
  } catch { /* Malformed arguments provide no trustworthy command. */ }
  return undefined
}

/** Recorded effects only; no Git/worktree scan and no invented test verdicts. */
export function taskOverview(entries: readonly UiEntry[], startIndex = 0, includeLineCounts = true): TaskOverview {
  const paths = new Map<string, { before: string | null; after: string; continuous: boolean; edits: number }>()
  const commands: TaskOverview['commands'] = []
  entries.forEach((entry, index) => {
    if (entry.kind === 'shell') commands.push({ command: entry.command,
      outcome: entry.timedOut ? 'timeout' : entry.exitCode === null ? entry.signal ?? 'error' : `exit ${entry.exitCode}`, entry: startIndex + index + 1 })
    if (entry.kind !== 'tool') return
    const calls = [
      { args: entry.args, status: entry.status, meta: entry.resultMeta },
      ...(entry.subCalls?.map(call => ({ args: call.args, status: call.status, meta: call.meta })) ?? []),
    ]
    for (const call of calls) {
      const command = commandText(call.args)
      if (command !== undefined) commands.push({ command, outcome: call.status, entry: startIndex + index + 1 })
      for (const diff of recordedDiffs(call.meta)) {
        const previous = paths.get(diff.path)
        paths.set(diff.path, previous ? { ...previous, after: diff.newText, edits: previous.edits + 1,
          continuous: previous.continuous && previous.after === diff.oldText }
          : { before: diff.oldText, after: diff.newText, edits: 1, continuous: true })
      }
    }
  })
  return { commands, files: [...paths].map(([path, file]) => ({ path, edits: file.edits,
    ...(includeLineCounts && file.continuous ? lineDelta(file.before, file.after) : undefined) })) }
}
