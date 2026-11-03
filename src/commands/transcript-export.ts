import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { UiEntry } from '../core/types.ts'
import { transcriptMarkdown } from './transcript.ts'

/** User-requested export. Exclusive creation prevents accidental overwrites. */
export async function exportTranscript(path: string, cwd: string, entries: readonly UiEntry[]): Promise<string> {
  const target = resolve(cwd, path)
  await writeFile(target, transcriptMarkdown(entries), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return target
}
