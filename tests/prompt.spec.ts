import { describe, expect, it } from 'vitest'
import { insertTextAtCursor, removeCharBeforeCursor } from '../src/components/Prompt.tsx'

describe('prompt cursor editing', () => {
  it('inserts text at the cursor instead of always appending', () => {
    expect(insertTextAtCursor('hello', 2, 'X')).toBe('heXllo')
    expect(insertTextAtCursor('hello', 5, 'X')).toBe('helloX')
  })

  it('removes the character immediately before the cursor', () => {
    expect(removeCharBeforeCursor('hello', 4)).toBe('helo')
    expect(removeCharBeforeCursor('hello', 0)).toBe('hello')
  })
})
