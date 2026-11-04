import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { DRAFT_SAVE_MS, type DraftChannel, type DraftSnapshot } from '../terminal/drafts.ts'

/** A channel is stable for one prompt mount; the session key remounts the prompt. */
export function useDraftPersistence(channel: DraftChannel | undefined, initial: DraftSnapshot,
  snapshot: DraftSnapshot, onFailure?: () => void): () => void {
  const latest = useRef(snapshot)
  latest.current = snapshot
  const saved = useRef(initial)
  const reported = useRef(false)
  const failure = useRef(onFailure)
  failure.current = onFailure
  const persist = useCallback((next: DraftSnapshot, report: boolean) => {
    if (!channel || (saved.current.text === next.text && saved.current.cursor === next.cursor)) return
    if (channel.save(next)) { saved.current = next; reported.current = false }
    else if (report && !reported.current) { reported.current = true; failure.current?.() }
  }, [channel])
  useEffect(() => {
    const timer = setTimeout(() => { persist(latest.current, true) }, DRAFT_SAVE_MS)
    return () => { clearTimeout(timer) }
  }, [snapshot.text, snapshot.cursor, persist])
  useLayoutEffect(() => () => { persist(latest.current, false) }, [persist])
  return useCallback(() => {
    const empty = { text: '', cursor: 0 }
    latest.current = empty
    // Submission clears immediately, even when the debounce has not run yet.
    if (channel?.save(empty)) saved.current = empty
    else if (channel && !reported.current) { reported.current = true; failure.current?.() }
  }, [channel])
}
