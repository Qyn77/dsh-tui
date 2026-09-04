/**
 * `/copy`'s pure half: the OSC 52 sequence, the tmux wrap, and what gets picked
 * out of the conversation.
 *
 * The bytes are the whole contract here. Nothing in this repo can observe a
 * clipboard, so what these cases pin is that the sequence is *exactly* the one
 * terminals implement — the base64 against known values rather than against
 * another `Buffer.from` call, and the tmux passthrough's escape doubling, which
 * is the difference between working and silently doing nothing under tmux.
 * @module @deepseek-ai/dsh-tui/tests/clipboard.spec
 */

import { describe, expect, it } from 'vitest'
import {
  OSC52_MAX_BYTES,
  byteLength,
  clampForClipboard,
  multiplexerFromEnv,
  osc52,
  pickCopyText,
} from '../src/clipboard.ts'
import type { UiEntry } from '../src/types.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Built, never quoted: an invisible ESC byte in a spec is unreviewable. */
const ESC = '\u001B'
const BEL = '\u0007'

function reply(text: string, finalized = true): UiEntry {
  return { kind: 'assistant', turn: 1, step: 1, text, finalized }
}

describe('osc52', () => {
  it('frames the base64 payload as an OSC 52 clipboard write', () => {
    // Against a literal, not against another Buffer call: the point is that the
    // encoding is the one a terminal will decode, and comparing the
    // implementation to itself would pass even if it emitted base64url.
    expect(osc52('hi')).toBe(`${ESC}]52;c;aGk=${BEL}`)
  })

  it('encodes UTF-8, not code units', () => {
    expect(osc52('你好')).toBe(`${ESC}]52;c;5L2g5aW9${BEL}`)
    // A surrogate pair is one code point and four bytes. An implementation that
    // encoded UTF-16 would produce something a terminal pastes as mojibake.
    expect(osc52('🐳')).toBe(`${ESC}]52;c;8J+Qsw==${BEL}`)
  })

  it('sends nothing but the frame for empty text', () => {
    expect(osc52('')).toBe(`${ESC}]52;c;${BEL}`)
  })

  it('wraps for tmux and doubles every escape inside the payload', () => {
    // The doubling is the test. tmux's passthrough ends at the first `ESC \`, so
    // an undoubled inner ESC terminates the DCS early and the clipboard write is
    // discarded — which looks exactly like a terminal that does not support
    // OSC 52 at all.
    expect(osc52('hi', { multiplexer: 'tmux' }))
      .toBe(`${ESC}Ptmux;${ESC}${ESC}]52;c;aGk=${BEL}${ESC}\\`)
  })

  it('leaves the passthrough terminator undoubled', () => {
    const wrapped = osc52('hi', { multiplexer: 'tmux' })
    // Doubling the closing escape too would leave the sequence unterminated.
    expect(wrapped.endsWith(`${ESC}\\`)).toBe(true)
    expect(wrapped.endsWith(`${ESC}${ESC}\\`)).toBe(false)
  })

  it('does not wrap when there is no multiplexer', () => {
    expect(osc52('hi', {})).toBe(osc52('hi'))
    expect(osc52('hi', { multiplexer: undefined })).toBe(osc52('hi'))
  })
})

describe('multiplexerFromEnv', () => {
  it('reports tmux when TMUX names a socket', () => {
    expect(multiplexerFromEnv({ TMUX: '/tmp/tmux-501/default,1234,0' })).toBe('tmux')
  })

  it('reports nothing for an absent or empty TMUX', () => {
    expect(multiplexerFromEnv({})).toBeUndefined()
    expect(multiplexerFromEnv({ TMUX: '' })).toBeUndefined()
  })

  it('does not read TERM', () => {
    // `TERM=screen-256color` is what tmux itself usually reports, so it is not
    // evidence of GNU screen — and screen is deliberately unhandled anyway.
    expect(multiplexerFromEnv({ TERM: 'screen-256color' })).toBeUndefined()
    expect(multiplexerFromEnv({ STY: '1234.pts-0.host' })).toBeUndefined()
  })
})

describe('pickCopyText', () => {
  it('finds nothing in an empty conversation', () => {
    expect(pickCopyText([], 'reply')).toBeUndefined()
    expect(pickCopyText([], 'code')).toBeUndefined()
  })

  it('takes the newest reply, as markdown source', () => {
    const found = pickCopyText([reply('first'), reply('## Second\n\n**bold**')], 'reply')
    // The markdown is not rendered away: what someone pastes into an editor
    // should be what the model wrote, not the terminal's drawing of it.
    expect(found).toEqual({ text: '## Second\n\n**bold**', target: 'reply' })
  })

  it('looks past a tool call and a user line to reach the reply', () => {
    const entries: UiEntry[] = [
      reply('the answer'),
      { kind: 'tool', callId: 'c1' as never, name: 'Read', args: '{}', turn: 1, step: 1, status: 'ok' },
      { kind: 'user', message: createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }) },
    ]
    expect(pickCopyText(entries, 'reply')?.text).toBe('the answer')
  })

  it('takes a still-streaming reply', () => {
    // What is on screen is what `/copy` copies. Refusing an unfinalized reply
    // would mean the command failing for the entry the user is watching.
    expect(pickCopyText([reply('half a th', false)], 'reply')?.text).toBe('half a th')
  })

  it('skips an empty reply', () => {
    // A turn that has started but produced no text yet is not a copy target;
    // the reply before it is.
    expect(pickCopyText([reply('earlier'), reply('')], 'reply')?.text).toBe('earlier')
  })

  it('takes the last fenced block of the reply that holds one', () => {
    const found = pickCopyText([reply('```ts\nfirst()\n```\n\n```sh\nsecond\n```')], 'code')
    expect(found).toEqual({ text: 'second', target: 'code' })
  })

  it('reaches back past replies with no code at all', () => {
    // "copy that snippet" usually arrives a few turns after the snippet, so the
    // search is over the conversation rather than over the newest reply only.
    const entries = [reply('```py\nprint(1)\n```'), reply('does that help?')]
    expect(pickCopyText(entries, 'code')?.text).toBe('print(1)')
  })

  it('does not mistake an inline span for a block', () => {
    const entries = [reply('use `npm i` for that')]
    expect(pickCopyText(entries, 'code')).toBeUndefined()
    expect(pickCopyText(entries, 'reply')?.text).toBe('use `npm i` for that')
  })

  it('copies only assistant entries', () => {
    // Guard against a future entry shape: only `assistant` entries are copied,
    // and a compaction note or a command echo is never the target.
    const entries: UiEntry[] = [
      reply('the answer'),
      { kind: 'command', input: '/help', text: 'a table', failed: false },
      { kind: 'note', text: 'something happened' },
    ]
    expect(pickCopyText(entries, 'reply')?.text).toBe('the answer')
  })
})

describe('clampForClipboard', () => {
  it('passes text under the cap through untouched', () => {
    const clamped = clampForClipboard('short')
    expect(clamped).toEqual({ text: 'short', truncated: false })
  })

  it('cuts at the cap and says so', () => {
    const clamped = clampForClipboard('x'.repeat(OSC52_MAX_BYTES + 10))
    expect(clamped.truncated).toBe(true)
    expect(byteLength(clamped.text)).toBe(OSC52_MAX_BYTES)
  })

  it('never cuts a code point in half', () => {
    // 3 bytes each, so the cap lands mid-character. A lone replacement char in
    // the clipboard is worse than one fewer character.
    const clamped = clampForClipboard('好'.repeat(OSC52_MAX_BYTES))
    expect(clamped.truncated).toBe(true)
    expect(clamped.text.endsWith('�')).toBe(false)
    expect(byteLength(clamped.text)).toBeLessThanOrEqual(OSC52_MAX_BYTES)
  })

  it('reports bytes, not characters', () => {
    // The count `/copy` prints has to be in the unit the cap is stated in: a CJK
    // reply whose character count looks comfortable can still be the clamped one.
    expect(byteLength('你好')).toBe(6)
    expect(byteLength('hi')).toBe(2)
  })
})
