/** Provider-neutral file-change presentation. No filesystem reads. */
import type { FileDiff } from '@deepseek-ai/dsh-tools'
import type { UiEntry } from '../core/types.ts'

export function recordedDiffs(meta: unknown): FileDiff[] {
  if (!meta || typeof meta !== 'object' || !('diffs' in meta) || !Array.isArray(meta.diffs)) return []
  return meta.diffs.filter((diff): diff is FileDiff => !!diff && typeof diff === 'object'
    && typeof diff.path === 'string' && (diff.oldText === null || typeof diff.oldText === 'string')
    && typeof diff.newText === 'string')
}

/** Compact contextual changes, retaining a truthful unavailable-before state. */
export function diffLines(diff: FileDiff): string[] {
  const before = diff.oldText ? diff.oldText.split('\n') : []
  const after = diff.newText ? diff.newText.split('\n') : []
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  if (prefix === before.length && prefix === after.length) return []
  const contextStart = Math.max(0, prefix - 3)
  const contextAfter = Math.min(suffix, 3)
  return [
    `--- ${diff.path}`,
    `+++ ${diff.path}`,
    `@@ -${contextStart + 1},${before.length - contextStart - suffix + contextAfter} +${contextStart + 1},${after.length - contextStart - suffix + contextAfter} @@`,
    ...before.slice(Math.max(0, prefix - 3), prefix).map(line => ` ${line}`),
    ...before.slice(prefix, before.length - suffix).map(line => `-${line}`),
    ...after.slice(prefix, after.length - suffix).map(line => `+${line}`),
    ...after.slice(after.length - suffix, Math.min(after.length, after.length - suffix + 3)).map(line => ` ${line}`),
  ]
}

export function transcriptDiffs(entries: readonly UiEntry[]): FileDiff[] {
  return entries.flatMap(entry => entry.kind === 'tool'
    ? [...recordedDiffs(entry.resultMeta), ...(entry.subCalls?.flatMap(call => recordedDiffs(call.meta)) ?? [])]
    : [])
}
