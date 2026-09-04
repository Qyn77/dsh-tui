/**
 * Bracketed-paste decoding.
 *
 * The behaviour under test is not "does it strip a marker" but "can a paste
 * still submit half a message". A terminal in raw mode sends a pasted newline
 * as `\r`, the same byte Enter sends, and stdin splits a large paste across
 * chunks — so a chunk boundary landing on a newline used to arrive as a lone
 * `\r`, which Ink names `return`. The markers are the only thing that can
 * tell the two apart, and these tests pin that they do.
 *
 * `ESC` is built with `String.fromCharCode`, never written literally: a raw
 * escape byte in a source file is invisible in every diff and every review
 * that would otherwise catch it going missing.
 * @module @deepseek-ai/dsh-tui/tests/paste.spec
 */

import { describe, expect, it } from 'vitest'
import { readPaste } from '../src/paste.ts'
import { ESC } from './fake-tty.ts'

const CR = String.fromCharCode(13)
/** The opener as Ink delivers it mid-chunk, escape intact. */
const START = `${ESC}[200~`
/** The terminator, likewise. */
const END = `${ESC}[201~`

describe('readPaste', () => {
  it('leaves ordinary typing alone', () => {
    expect(readPaste('a', false)).toEqual({ text: 'a', open: false, bracketed: false })
  })

  it('unwraps a paste that arrives whole', () => {
    const result = readPaste(`${START}hello${CR}world${END}`, false)

    expect(result.text).toBe('hello\nworld')
    expect(result.open).toBe(false)
    expect(result.bracketed).toBe(true)
  })

  it('accepts the bare opener Ink produces at the head of a chunk', () => {
    // `useInput` strips one leading ESC from every chunk, so the marker that
    // begins a paste is the one form that never arrives intact. Reading only
    // the escaped form would miss the common case entirely.
    const result = readPaste(`[200~hi${END}`, false)

    expect(result.text).toBe('hi')
    expect(result.bracketed).toBe(true)
  })

  it('stays open across chunks and swallows the newline that split them', () => {
    // The regression: chunk two is a lone CR, which Ink has already named
    // `return`. It must become text, not a submission.
    const first = readPaste(`${START}a`, false)
    expect(first).toEqual({ text: 'a', open: true, bracketed: true })

    const second = readPaste(CR, first.open)
    expect(second).toEqual({ text: '\n', open: true, bracketed: true })

    const third = readPaste(`b${END}`, second.open)
    expect(third).toEqual({ text: 'b', open: false, bracketed: true })
  })

  it('normalises CRLF to a single newline', () => {
    expect(readPaste(`${START}a${CR}\nb${END}`, false).text).toBe('a\nb')
  })

  it('normalises stray CRs in unbracketed input too', () => {
    // The fallback for terminals that ignore `?2004`. It fixes the
    // overprinting; it cannot fix a split chunk, because a lone CR with no
    // marker around it is genuinely indistinguishable from Enter.
    const result = readPaste(`a${CR}b`, false)

    expect(result.text).toBe('a\nb')
    expect(result.bracketed).toBe(false)
  })

  it('keeps typing that shares a chunk with the opener', () => {
    expect(readPaste(`xy${START}z`, false).text).toBe('xyz')
  })

  it('reports a marker-only chunk as bracketed with nothing to insert', () => {
    // The caller uses `bracketed` to decide whether to skip key dispatch, so
    // an empty text must not read as "not a paste".
    expect(readPaste(START, false)).toEqual({ text: '', open: true, bracketed: true })
    expect(readPaste(END, true)).toEqual({ text: '', open: false, bracketed: true })
  })
})
