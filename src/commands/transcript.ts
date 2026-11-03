/** Lossless text inspection over the uncollapsed UI projection. */
import { userMessageText, type UiEntry } from '../core/types.ts'

export function entryText(entry: UiEntry): string {
  switch (entry.kind) {
    case 'user': return userMessageText(entry.message) || JSON.stringify(entry.message.content, null, 2)
    case 'assistant': return entry.text
    case 'tool': return [entry.name, entry.args, ...entry.result?.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)) ?? []].join('\n')
    case 'command': return `${entry.input}\n${entry.text}`
    case 'shell': return `${entry.command}\n${entry.output}`
    case 'note': return entry.text
    default: return JSON.stringify(entry, null, 2)
  }
}

export interface TranscriptMatch { index: number; kind: UiEntry['kind']; preview: string }

export function searchTranscript(entries: readonly UiEntry[], query: string): TranscriptMatch[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  return entries.flatMap((entry, index) => {
    if (entry.kind === 'command') return []
    const text = entryText(entry)
    const at = text.toLocaleLowerCase().indexOf(needle)
    return at < 0 ? [] : [{ index, kind: entry.kind,
      preview: text.slice(Math.max(0, at - 30), at + needle.length + 90).replace(/\s+/g, ' ') }]
  })
}

export function entryNumber(value: string | undefined, length: number): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined
  const index = Number(value) - 1
  return Number.isSafeInteger(index) && index < length ? index : undefined
}

export function transcriptMarkdown(entries: readonly UiEntry[]): string {
  return entries.map((entry, index) => {
    const text = entryText(entry)
    // Keep literal tool output out of Markdown headings and fences it may
    // contain. Choose a fence longer than every run in the source.
    if (entry.kind === 'tool' || entry.kind === 'shell') {
      const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)))
      return `## ${index + 1}. ${entry.kind}\n\n${fence}text\n${text}\n${fence}`
    }
    return `## ${index + 1}. ${entry.kind}\n\n${text}`
  }).join('\n\n') + '\n'
}

/** Resolve navigation without changing the transcript or search results. */
export function navigationIndex(
  value: string | undefined, entries: readonly UiEntry[], selected?: number, matches: readonly number[] = [],
): number | undefined {
  const numbered = entryNumber(value, entries.length)
  if (numbered !== undefined) return numbered
  if (value === 'next') return matches.find(index => index > (selected ?? -1)) ?? matches[0]
  if (value === 'prev') return [...matches].reverse().find(index => index < (selected ?? entries.length)) ?? matches.at(-1)
  if (value !== 'user' && value !== 'tool' && value !== 'error') return undefined
  for (let index = (selected ?? entries.length) - 1; index >= 0; index--) {
    const entry = entries[index]
    if (entry.kind === value || (value === 'error' && ((entry.kind === 'note' && entry.tone === 'error')
      || (entry.kind === 'tool' && entry.status === 'error') || (entry.kind === 'command' && entry.failed)))) return index
  }
  return undefined
}
