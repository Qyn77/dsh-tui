/**
 * The file list behind the `@` picker: scanned once, then filtered in memory.
 *
 * Scanning per keystroke would be the obvious shape and the wrong one — a
 * repo-sized `readdir` walk between `@s` and `@sr` makes the picker feel like
 * it is thinking, and the answers would race each other on the way back. The
 * walk instead happens once per mention session and its result is filtered
 * synchronously, so every keystroke after the first is instant and ordered.
 *
 * The cache is keyed by working directory because `!cd` moves it (SPEC §1.9),
 * and a picker still offering the old directory's files after a `cd` would be
 * offering paths that no longer resolve.
 * @module @deepseek-ai/dsh-tui/hooks/useFileMentions
 */

import { useEffect, useRef, useState } from 'react'
import { listFiles, rankPaths } from '../file-mentions.ts'

/** Rows the picker shows at once. Same eight as the output previews. */
export const MAX_MENTION_ROWS = 8

/** What the picker knows right now. */
export interface FileMentions {
  /** The best matches, best first. Empty while `scanning`, or on no match. */
  paths: readonly string[]
  /** Whether the first directory walk is still in flight. */
  scanning: boolean
}

/**
 * Rank the files under the current directory against `query`.
 *
 * `scanning` is reported rather than hidden because the alternative is a
 * picker that stays invisible for as long as a large repo takes to walk, which
 * reads as "the key did nothing" and gets pressed again.
 * @param query - the mention's text, or `undefined` when no mention is active.
 */
export function useFileMentions(query: string | undefined): FileMentions {
  const [files, setFiles] = useState<readonly string[] | null>(null)
  // The directory `files` was scanned from, so a `!cd` invalidates it and a
  // re-render does not re-scan.
  const scanned = useRef<string | null>(null)

  const active = query !== undefined
  useEffect(() => {
    if (!active) return
    const cwd = process.cwd()
    if (scanned.current === cwd) return
    let live = true
    scanned.current = cwd
    setFiles(null)
    void listFiles(cwd).then((found) => {
      if (live) setFiles(found)
    }, () => {
      // An unreadable cwd is a picker with no rows, not a crash.
      if (live) setFiles([])
    })
    return () => { live = false }
  }, [active])

  if (query === undefined) return { paths: [], scanning: false }
  if (files === null) return { paths: [], scanning: true }
  return { paths: rankPaths(files, query, MAX_MENTION_ROWS), scanning: false }
}
