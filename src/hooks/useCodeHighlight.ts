/**
 * The React side of syntax highlighting: load a grammar for a fence, then keep
 * one resumable tokenizing cache per code block.
 *
 * The load is asynchronous and the render is not, so a code block draws plain
 * for the frame or two before its grammar arrives and colors in afterwards.
 * That is the honest shape of the constraint rather than a compromise — the
 * alternative is holding the block back until Shiki is ready, which would stall
 * the answer on a highlighter.
 * @module @deepseek-ai/dsh-tui/hooks/useCodeHighlight
 */

import { useEffect, useMemo, useState } from 'react'
import {
  createLineCache,
  highlightLang,
  loadTokenizer,
  type CodeLine,
  type LineTokenizer,
} from '../highlight.ts'

/**
 * Highlighted lines for one code block, or `undefined` while there is nothing
 * better than plain text to draw.
 *
 * `undefined` covers three different situations on purpose, because the caller
 * does the same thing in all three: the fence named no language, Shiki has no
 * grammar for the one it named, and the grammar has not finished loading. Only
 * the third is temporary, and the renderer cannot act on the distinction.
 *
 * The cache is read during render, which mutates it. That is sound because
 * `lines` is a function of the code it is handed — a second call with the same
 * text re-tokenizes nothing and returns the same lines — so a double render
 * costs nothing and cannot produce a different answer.
 * @param lang - the fence's language word, exactly as the model wrote it.
 * @param code - the block's full text, which grows while the turn streams.
 */
export function useCodeHighlight(lang: string, code: string): CodeLine[] | undefined {
  const grammar = highlightLang(lang)
  const [tokenizer, setTokenizer] = useState<LineTokenizer | undefined>(undefined)

  useEffect(() => {
    if (grammar === undefined) return
    let live = true
    void loadTokenizer(grammar).then((next) => {
      // `setTokenizer(next)` would read a function as a state updater and call
      // it with the previous tokenizer. The wrapper is what stores it instead.
      if (live && next !== undefined) setTokenizer(() => next)
    })
    return () => { live = false }
  }, [grammar])

  // One cache per tokenizer, so a block keeps its tokenized prefix across every
  // delta of the turn that is writing it.
  const cache = useMemo(
    () => tokenizer === undefined ? undefined : createLineCache(tokenizer),
    [tokenizer],
  )
  return cache?.lines(code)
}
