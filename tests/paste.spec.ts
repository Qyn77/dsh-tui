/** Paste regression tests use the production incremental decoder. */
import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'
import { TerminalInputDecoder } from '../src/terminal/adapters/input.ts'
const START = '\u001b[200~'
const END = '\u001b[201~'
describe('terminal paste boundary', () => {
  it('treats bare markers as literal text because Ink no longer strips ESC', () => {
    expect(new TerminalInputDecoder().feed('[200~hi')).toMatchObject([{ kind: 'key', input: '[200~hi' }])
  })
  it('normalizes unbracketed multiline input without submitting it', () => {
    expect(new TerminalInputDecoder().feed('a\rb')).toMatchObject([{ kind: 'key', input: 'a\nb', key: { return: false } }])
  })
  it('never submits a pasted carriage return arriving in its own chunk', () => {
    const decoder = new TerminalInputDecoder()
    const events = [START + 'a', '\r', '\n', 'b' + END].flatMap(chunk => decoder.feed(chunk))
    expect(events.map(e => e.kind)).toEqual(['paste-start', 'paste-text', 'paste-text', 'paste-text', 'paste-end'])
    expect(events.filter(e => e.kind === 'paste-text').map(e => e.text).join('')).toBe('a\nb')
  })
  it('keeps typing before and after a paste as separate semantic events', () => {
    expect(new TerminalInputDecoder().feed(`xy${START}z${END}q`)).toMatchObject([
      { kind: 'key', input: 'xy' }, { kind: 'paste-start' }, { kind: 'paste-text', text: 'z' },
      { kind: 'paste-end', empty: false }, { kind: 'key', input: 'q' },
    ])
  })
  it('preserves empty paste as a hint, separate from an explicit shortcut', () => {
    expect(new TerminalInputDecoder().feed(START + END)).toEqual([{ kind: 'paste-start' }, { kind: 'paste-end', empty: true }])
  })
})

it('applies coalesced Ctrl-A/Ctrl-K to the prompt instead of inserting them', async () => {
  const tty = await paintApp()
  try {
    await tty.send('remove me')
    await tty.send('\u0001\u000b')
    expect(tty.screen()).not.toContain('remove me')
    expect(tty.screen()).toContain('Ask dsh anything')
  } finally { tty.unmount() }
})
