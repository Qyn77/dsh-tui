/**
 * The React side of syntax highlighting: load a grammar for a fence, then keep
 * one resumable tokenizing cache per code block.
 *
 * The load is asynchronous and the render is not, so a code block draws plain
 * for the frame or two before its grammar arrives and colors in afterwards.
 * That is the honest shape of the constraint rather than a compromise — the
 * alternative is holding the block back until Shiki is ready, which would stall
 * the answer on a highlighter.
 *
 * A `/theme` switch is the same load, and it deliberately keeps drawing the old
 * theme's colors until the new theme's tokenizer arrives instead of dropping
 * back to plain first. Both readings cost the same number of rows; one of them
 * flashes.
 * @module @deepseek-ai/dsh-tui/hooks/useCodeHighlight
 */

import { useEffect, useMemo, useState } from 'react'
import { usePalette } from './useTheme.tsx'
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
  const { shikiTheme } = usePalette()
  const [tokenizer, setTokenizer] = useState<LineTokenizer | undefined>(undefined)

  useEffect(() => {
    if (grammar === undefined) return
    let live = true
    void loadTokenizer(grammar, shikiTheme).then((next) => {
      // `setTokenizer(next)` would read a function as a state updater and call
      // it with the previous tokenizer. The wrapper is what stores it instead.
      if (live && next !== undefined) setTokenizer(() => next)
    })
    return () => { live = false }
  }, [grammar, shikiTheme])

  // One cache per tokenizer, so a block keeps its tokenized prefix across every
  // delta of the turn that is writing it. A `/theme` switch produces a new
  // tokenizer and therefore a new cache — correct, and not something to
  // optimize away, since the cached tokens are the ones carrying the colors.
  const cache = useMemo(
    () => tokenizer === undefined ? undefined : createLineCache(tokenizer),
    [tokenizer],
  )
  return cache?.lines(code)
}
