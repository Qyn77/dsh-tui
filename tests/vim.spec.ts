/**
 * The modal keymap.
 *
 * `src/prompt/vim.ts` is a pure state machine, which is the whole reason it is a
 * separate module: the interesting claims about modal editing are about what a
 * key *does to text*, and none of them need a frame. What the frame has to
 * answer — that a letter in normal mode is never typed, and that Esc reaches
 * the right owner — is in `vim-frame.spec.ts`.
 *
 * The caret convention is load-bearing throughout and is asserted here rather
 * than assumed: this prompt draws a bar *between* two characters, so `$`, `e`
 * and the end of a `dw` all name the position *after* a character, not on it.
 * @module @qiao-qyn/dsh-tui/tests/vim.spec
 */

import { describe, expect, it } from 'vitest'
import {
  INITIAL_VIM,
  KEYBIND_PREFS,
  applyVim,
  firstNonBlank,
  isKeybindPref,
  lineEnd,
  lineStart,
  motionTarget,
  nextWordStart,
  prevWordStart,
  wordEnd,
  type VimState,
} from '../src/prompt/vim.ts'

const NORMAL: VimState = { mode: 'normal', pending: '', register: '' }

/** Press one printable key. */
function press(state: VimState, input: string, text: string, cursor: number) {
  return applyVim(state, { input, escape: false, return: false }, text, cursor)
}

/** Press a sequence, threading the buffer, caret and mode through it. */
function type(
  keys: string,
  text: string,
  cursor = 0,
  state: VimState = NORMAL,
): { text: string; cursor: number; state: VimState } {
  let current = { text, cursor, state }
  for (const key of keys) {
    const result = press(current.state, key, current.text, current.cursor)
    if (!result.handled) throw new Error(`unhandled key ${JSON.stringify(key)}`)
    current = { text: result.text, cursor: result.cursor, state: result.state }
  }
  return current
}

describe('the keybind preference', () => {
  it('accepts exactly the two settings it offers', () => {
    expect(KEYBIND_PREFS).toEqual(['default', 'vim'])
    expect(isKeybindPref('vim')).toBe(true)
    expect(isKeybindPref('default')).toBe(true)
  })

  it.each([['emacs'], [''], ['VIM'], [null], [3]])('rejects %o', (value) => {
    // A preference file is hand-editable and shared with the launcher, so an
    // unrecognised value has to fall back rather than reach the keymap.
    expect(isKeybindPref(value)).toBe(false)
  })

  it('starts in insert, so switching keybinds on eats nothing', () => {
    expect(INITIAL_VIM.mode).toBe('insert')
  })
})

describe('insert mode', () => {
  it('declines every key except Esc, so the readline editor is untouched', () => {
    // This is the design, not an omission: turning vim on must not cost the
    // user Ctrl-A, the palette, history recall or paste — all of which live in
    // `Prompt.tsx` and all of which only run when this module declines.
    for (const input of ['i', 'd', 'x', 'a', '0', 'q', ' ']) {
      expect(applyVim(INITIAL_VIM, { input, escape: false, return: false }, 'hi', 1))
        .toEqual({ handled: false })
    }
  })

  it('takes Esc into normal mode without moving the caret', () => {
    // vi steps left here because its block caret would sit past the line's
    // end. This caret is a bar between characters, where that position is a
    // real place to be, so stepping would move off what was just typed.
    const result = applyVim(INITIAL_VIM, { input: '', escape: true, return: false }, 'hello', 5)
    if (!result.handled) throw new Error('Esc must be handled')
    expect(result.state.mode).toBe('normal')
    expect(result.cursor).toBe(5)
  })
})

describe('normal mode motions', () => {
  it.each([
    ['h', 3, 2],
    ['l', 3, 4],
    ['0', 3, 0],
    ['$', 3, 11],
    ['w', 0, 6],
    ['b', 8, 6],
    ['e', 0, 5],
    ['G', 0, 11],
  ])('%s from %i lands on %i', (key, from, to) => {
    expect(motionTarget(key, 'hello world', from)).toBe(to)
  })

  it('stops h and l at the line, not at the buffer', () => {
    // A buffer with newlines is one paste, not one line, and a vi user
    // pressing `l` at the end of a line does not expect to arrive on the next.
    expect(motionTarget('h', 'ab\ncd', 3)).toBe(3)
    expect(motionTarget('l', 'ab\ncd', 2)).toBe(2)
  })

  it('takes gg to the top and G to the bottom', () => {
    expect(type('gg', 'one\ntwo\nthree', 9).cursor).toBe(0)
    expect(type('G', 'one\ntwo\nthree', 0).cursor).toBe(13)
  })

  it('leaves g pending until its second key, and abandons a g that is not gg', () => {
    const half = press(NORMAL, 'g', 'abc', 2)
    if (!half.handled) throw new Error('g must be handled')
    expect(half.state.pending).toBe('g')
    // `gq` is not a motion this build has; it must do nothing rather than
    // guess at something.
    const after = press(half.state, 'q', 'abc', 2)
    if (!after.handled) throw new Error('the pending key must be consumed')
    expect(after.state.pending).toBe('')
    expect(after.text).toBe('abc')
    expect(after.cursor).toBe(2)
  })

  it('sends ^ to the first non-blank, and 0 to the true start', () => {
    expect(firstNonBlank('   git add', 8)).toBe(3)
    expect(lineStart('   git add', 8)).toBe(0)
  })

  it('leaves a blank line alone rather than walking ^ off the end', () => {
    expect(firstNonBlank('a\n   \nb', 4)).toBe(2)
  })

  it('treats a path as one word, the way the readline motions do', () => {
    // The definition is `prompt-editing.ts`'s and the reason is the same: a `w`
    // that stopped inside `~/.dsh/.env` is a key you press six times.
    expect(nextWordStart('cat ~/.dsh/.env now', 4)).toBe(16)
    expect(prevWordStart('cat ~/.dsh/.env now', 16)).toBe(4)
    expect(wordEnd('cat ~/.dsh/.env now', 4)).toBe(15)
  })

  it('reports j and k as a row delta, because only the component can measure one', () => {
    const down = press(NORMAL, 'j', 'a very long line', 0)
    if (!down.handled) throw new Error('j must be handled')
    expect(down.rowDelta).toBe(1)
    const up = press(NORMAL, 'k', 'a very long line', 0)
    if (!up.handled) throw new Error('k must be handled')
    expect(up.rowDelta).toBe(-1)
  })

  it('swallows a key it does not know rather than typing it', () => {
    // The single most important rule in the module. A `q` that fell through
    // would be typed into the buffer, and a modal editor that sometimes types
    // its own commands is worse than none at all.
    const result = press(NORMAL, 'q', 'hello', 2)
    if (!result.handled) throw new Error('an unknown key must still be consumed')
    expect(result.text).toBe('hello')
    expect(result.cursor).toBe(2)
  })
})

describe('entering insert mode', () => {
  it.each([
    ['i', 'git commit', 4, 4],
    ['a', 'git commit', 4, 5],
    ['I', '   git', 5, 3],
    ['A', 'git', 0, 3],
  ])('%s puts the caret at %i', (key, text, from, to) => {
    const result = type(key, text, from)
    expect(result.state.mode).toBe('insert')
    expect(result.cursor).toBe(to)
    expect(result.text).toBe(text)
  })

  it('opens a line below with o and above with O', () => {
    const below = type('o', 'one\ntwo', 1)
    expect(below.text).toBe('one\n\ntwo')
    expect(below.cursor).toBe(4)
    expect(below.state.mode).toBe('insert')
    const above = type('O', 'one\ntwo', 5)
    expect(above.text).toBe('one\n\ntwo')
    expect(above.cursor).toBe(4)
  })
})

describe('deleting', () => {
  it('x removes the character the caret is in front of', () => {
    const result = type('x', 'hello', 1)
    expect(result.text).toBe('hllo')
    expect(result.cursor).toBe(1)
  })

  it('x at the end of a line does nothing, and does not eat the newline', () => {
    const result = type('x', 'ab\ncd', 2)
    expect(result.text).toBe('ab\ncd')
  })

  it.each([
    ['dw', 'git commit -m', 4, 'git -m'],
    ['db', 'git commit -m', 11, 'git -m'],
    ['d$', 'git commit -m', 4, 'git '],
    ['d0', 'git commit -m', 4, 'commit -m'],
    ['de', 'git commit -m', 4, 'git  -m'],
    ['dh', 'git commit', 4, 'gitcommit'],
  ])('%s on %o leaves %o', (keys, text, cursor, expected) => {
    expect(type(keys, text, cursor).text).toBe(expected)
  })

  it('D and C clear to the end of the line, and only C stays in insert', () => {
    expect(type('D', 'git commit -m', 4)).toMatchObject({ text: 'git ', state: { mode: 'normal' } })
    expect(type('C', 'git commit -m', 4)).toMatchObject({ text: 'git ', state: { mode: 'insert' } })
  })

  it('dd takes the line and its newline; cc keeps the line and empties it', () => {
    expect(type('dd', 'one\ntwo\nthree', 5).text).toBe('one\nthree')
    const changed = type('cc', 'one\ntwo\nthree', 5)
    expect(changed.text).toBe('one\n\nthree')
    expect(changed.state.mode).toBe('insert')
  })

  it('c leaves insert mode on, so the change can be typed', () => {
    expect(type('cw', 'git commit', 4).state.mode).toBe('insert')
  })

  it('abandons an operator whose next key is not a motion', () => {
    // `dq` deleting *something* would be the worst available answer.
    const result = type('dq', 'git commit', 4)
    expect(result.text).toBe('git commit')
    expect(result.state.pending).toBe('')
  })

  it('cancels a pending operator on Esc, and only then declines the key', () => {
    const pending = press(NORMAL, 'd', 'abc', 1)
    if (!pending.handled) throw new Error('d must be handled')
    const escaped = applyVim(pending.state, { input: '', escape: true, return: false }, 'abc', 1)
    if (!escaped.handled) throw new Error('Esc must clear the pending operator')
    expect(escaped.state.pending).toBe('')
    // With nothing pending, Esc is not the keymap's to take: the palette and
    // the App's turn-cancel both want it, and a vim user who cannot stop a
    // turn has lost more than they gained.
    expect(applyVim(escaped.state, { input: '', escape: true, return: false }, 'abc', 1))
      .toEqual({ handled: false })
  })

  it('passes Enter through, so the prompt keeps sole ownership of sending', () => {
    expect(applyVim(NORMAL, { input: '', escape: false, return: true }, 'hi', 2))
      .toEqual({ handled: false })
  })
})

describe('the register', () => {
  it('pastes a character-wise deletion after the caret', () => {
    const cut = type('dw', 'git commit -m', 4)
    expect(cut.state.register).toBe('commit ')
    const pasted = type('p', cut.text, 0, cut.state)
    expect(pasted.text).toBe('gcommit it -m')
  })

  it('pastes a line-wise deletion as a line, below with p and above with P', () => {
    const cut = type('dd', 'one\ntwo\nthree', 4)
    expect(cut.text).toBe('one\nthree')
    expect(type('p', cut.text, 0, cut.state).text).toBe('one\ntwo\nthree')
    expect(type('P', cut.text, 0, cut.state).text).toBe('two\none\nthree')
  })

  it('does nothing when nothing has been deleted yet', () => {
    expect(type('p', 'hello', 2).text).toBe('hello')
  })
})

describe('line arithmetic', () => {
  it.each([
    [0, 0, 3],
    [4, 4, 7],
    [9, 8, 13],
  ])('the line around %i runs from %i to %i', (cursor, start, end) => {
    expect(lineStart('one\ntwo\nthree', cursor)).toBe(start)
    expect(lineEnd('one\ntwo\nthree', cursor)).toBe(end)
  })

  it('clamps a caret index from outside rather than trusting it', () => {
    // Every one of these runs on a keystroke; a stale index from rapid input
    // must cost the user nothing.
    expect(lineStart('abc', 99)).toBe(0)
    expect(lineEnd('abc', -5)).toBe(3)
    expect(type('x', 'abc', 99).text).toBe('abc')
  })
})
