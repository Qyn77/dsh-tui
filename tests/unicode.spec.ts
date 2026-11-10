import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/core/width.ts'
import { insertTextAtCursor, removeCharBeforeCursor } from '../src/prompt/prompt-editing.ts'
import { columnAt, offsetAtColumn, wrapBuffer } from '../src/prompt/prompt-layout.ts'
import { applyVim, INITIAL_VIM, motionTarget } from '../src/prompt/vim.ts'

describe('Unicode prompt editing and layout', () => {
  it.each(['😀', 'e\u0301', '👨‍👩‍👧‍👦', '🇨🇳', '👍🏽'])('backspaces the entire grapheme %s', (glyph) => {
    expect(removeCharBeforeCursor(`a${glyph}z`, 1 + glyph.length)).toBe('az')
  })

  it('does not insert into a surrogate pair from a stale caret', () => {
    expect(insertTextAtCursor('😀z', 1, 'a')).toBe('a😀z')
  })

  it.each([['😀', 2], ['e\u0301', 1], ['👨‍👩‍👧‍👦', 2], ['🇨🇳', 2], ['👍🏽', 2]] as const)(
    'measures %s in display columns', (glyph, columns) => {
      expect(displayWidth(glyph)).toBe(columns)
      expect(wrapBuffer(`${glyph}a`, columns)).toEqual([{ text: glyph, start: 0 }, { text: 'a', start: glyph.length }])
      expect(offsetAtColumn({ text: `${glyph}a`, start: 0 }, columns)).toBe(glyph.length)
      expect(columnAt({ text: glyph, start: 0 }, glyph.length)).toBe(columns)
    },
  )

  it('moves Vim left and right and deletes without splitting graphemes', () => {
    const text = 'a👨‍👩‍👧‍👦e\u0301z'
    const end = 1 + '👨‍👩‍👧‍👦'.length
    expect(motionTarget('l', text, 1)).toBe(end)
    expect(motionTarget('h', text, end)).toBe(1)
    expect(applyVim({ ...INITIAL_VIM, mode: 'normal' }, { input: 'x', escape: false, return: false }, text, 1)).toMatchObject({ text: 'ae\u0301z', cursor: 1 })
  })
})
