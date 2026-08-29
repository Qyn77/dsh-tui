/**
 * The pure text operations behind the prompt's editing keys. Frame tests in
 * `prompt-frame.spec.ts` prove the keystrokes reach these; this file proves
 * the arithmetic, including the boundaries a frame test would need a
 * contrived buffer to reach.
 * @module @deepseek-ai/dsh-tui/tests/prompt-editing.spec
 */

import { describe, expect, it } from 'vitest'
import {
  deleteToEnd,
  deleteWordBefore,
  insertTextAtCursor,
  pushHistory,
  removeCharBeforeCursor,
  wordEndAfter,
  wordStartBefore,
} from '../src/prompt-editing.ts'

describe('insertion and single-character deletion', () => {
  it('inserts at the caret instead of always appending', () => {
    expect(insertTextAtCursor('abcd', 2, 'X')).toBe('abXcd')
  })

  it('clamps a caret index from outside the buffer', () => {
    expect(insertTextAtCursor('ab', 99, 'X')).toBe('abX')
    expect(insertTextAtCursor('ab', -5, 'X')).toBe('Xab')
  })

  it('removes the character immediately before the caret', () => {
    expect(removeCharBeforeCursor('abcd', 2)).toBe('acd')
  })

  it('leaves the buffer alone at its start', () => {
    expect(removeCharBeforeCursor('abcd', 0)).toBe('abcd')
  })
})

describe('word motions', () => {
  it('walks back over the word the caret follows', () => {
    expect(wordStartBefore('git commit', 10)).toBe(4)
  })

  it('skips the whitespace before finding the word', () => {
    // Sitting after the space, the previous *word* is `git`, not the gap.
    expect(wordStartBefore('git   ', 6)).toBe(0)
  })

  it('stops at the start of the buffer', () => {
    expect(wordStartBefore('git', 0)).toBe(0)
    expect(wordStartBefore('git', 2)).toBe(0)
  })

  it('walks forward to the end of the next word', () => {
    expect(wordEndAfter('git commit', 0)).toBe(3)
    expect(wordEndAfter('git commit', 3)).toBe(10)
  })

  it('stops at the end of the buffer', () => {
    expect(wordEndAfter('git commit', 10)).toBe(10)
  })

  it('treats a path as one word', () => {
    // The reason the definition is whitespace-only: six motions to cross
    // one filename would make the key useless for the thing people type.
    expect(wordStartBefore('cat ~/.dsh/.env', 15)).toBe(4)
  })
})

describe('word and tail deletion', () => {
  it('deletes the word before the caret and reports the new caret', () => {
    expect(deleteWordBefore('git commit', 10)).toEqual({ text: 'git ', cursor: 4 })
  })

  it('takes the trailing whitespace with the word', () => {
    expect(deleteWordBefore('ls -la ', 7)).toEqual({ text: 'ls ', cursor: 3 })
  })

  it('keeps what follows the caret', () => {
    expect(deleteWordBefore('git commit --amend', 10)).toEqual({
      text: 'git  --amend',
      cursor: 4,
    })
  })

  it('is a no-op at the start of the buffer', () => {
    expect(deleteWordBefore('git', 0)).toEqual({ text: 'git', cursor: 0 })
  })

  it('deletes from the caret to the end of the buffer', () => {
    expect(deleteToEnd('git commit', 4)).toBe('git ')
    expect(deleteToEnd('git commit', 0)).toBe('')
    expect(deleteToEnd('git commit', 10)).toBe('git commit')
  })
})

describe('prompt history', () => {
  it('appends the newest line last', () => {
    expect(pushHistory(['one'], 'two')).toEqual(['one', 'two'])
  })

  it('drops an empty submission', () => {
    expect(pushHistory(['one'], '')).toEqual(['one'])
  })

  it('drops a repeat of the newest entry', () => {
    // Sending /status twice to watch a number change should not cost two
    // Ctrl-P presses to walk back past.
    expect(pushHistory(['one', '/status'], '/status')).toEqual(['one', '/status'])
  })

  it('keeps a repeat that is not the newest entry', () => {
    expect(pushHistory(['/status', 'one'], '/status')).toEqual(['/status', 'one', '/status'])
  })

  it('does not mutate the history it is given', () => {
    const history = ['one']
    pushHistory(history, 'two')
    expect(history).toEqual(['one'])
  })
})
