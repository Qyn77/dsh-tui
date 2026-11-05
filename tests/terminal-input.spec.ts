import { describe, expect, it } from 'vitest'
import { TerminalInputDecoder } from '../src/terminal/adapters/input.ts'

const splits = (text: string) => Array.from({ length: Buffer.byteLength(text) + 1 }, (_, i) => i)
describe('incremental terminal input', () => {
  for (const sequence of ['\u001b[<0;12;4M', '\u001b[<64;12;4M', '\u001b[H', '\u001bOF', '\u001b[12~', '\u001b[A', '中文🙂']) {
    it(`decodes every byte split of ${JSON.stringify(sequence)}`, () => {
      const bytes = Buffer.from(sequence)
      const expected = new TerminalInputDecoder().feed(bytes)
      for (const cut of splits(sequence)) {
        const decoder = new TerminalInputDecoder()
        const actual = [...decoder.feed(bytes.subarray(0, cut)), ...decoder.feed(bytes.subarray(cut))]
        // Plain typing may arrive in several key events, but never loses UTF-8 characters.
        if (!sequence.startsWith('\u001b')) expect(actual.map(e => e.kind === 'key' ? e.input : '').join('')).toBe(sequence)
        else expect(actual).toEqual(expected)
      }
    })
  }
  it('never executes pasted mouse, navigation, control or F2 sequences', () => {
    const text = '中文\u001b[<0;1;1M\u001b[H\u0003\u001b[12~\r\nend'
    const bytes = Buffer.from(`\u001b[200~${text}\u001b[201~`)
    for (let cut = 0; cut <= bytes.length; cut++) {
      const decoder = new TerminalInputDecoder()
      const events = [...decoder.feed(bytes.subarray(0, cut)), ...decoder.feed(bytes.subarray(cut))]
      expect(events[0]).toEqual({ kind: 'paste-start' })
      expect(events.at(-1)).toEqual({ kind: 'paste-end', empty: false })
      expect(events.filter(e => e.kind === 'paste-text').map(e => e.text).join('')).toBe(text.replaceAll('\r\n', '\n'))
      expect(events.every(e => e.kind.startsWith('paste-'))).toBe(true)
    }
  })
  it('streams a large paste instead of buffering its whole body', () => {
    const decoder = new TerminalInputDecoder()
    decoder.feed('\u001b[200~')
    expect(decoder.feed('a'.repeat(100_000))).toEqual([{ kind: 'paste-text', text: 'a'.repeat(100_000) }])
    expect(decoder.feed('\u001b[201~')).toEqual([{ kind: 'paste-end', empty: false }])
  })
  it('isolates fragmented OSC and oversized replies from typing', () => {
    const decoder = new TerminalInputDecoder()
    expect(decoder.feed('\u001b]11;rgb:')).toEqual([])
    expect(decoder.feed('a'.repeat(5000))).toEqual([])
    expect(decoder.feed('tail\u0007hello')).toMatchObject([{ kind: 'report' }, { kind: 'key', input: 'hello' }])
  })
  it('distinguishes a standalone Escape from split sequences and clears state on handoff', () => {
    const decoder = new TerminalInputDecoder()
    expect(decoder.feed('\u001b')).toEqual([])
    expect(decoder.flushEscape()).toMatchObject([{ kind: 'key', key: { escape: true } }])
    decoder.feed('\u001b[200~'); decoder.reset()
    expect(decoder.feed('x')).toMatchObject([{ kind: 'key', input: 'x' }])
  })
  it('preserves coalesced reports and trailing text', () => {
    const events = new TerminalInputDecoder().feed('\u001b[<64;1;1M\u001b[<65;1;1Mhello')
    expect(events.map(e => e.kind)).toEqual(['pointer', 'pointer', 'key'])
  })
})
