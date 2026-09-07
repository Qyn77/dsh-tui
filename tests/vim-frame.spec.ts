/**
 * Modal editing as the user meets it.
 *
 * The keymap itself is pinned in `vim.spec.ts`; this file is about the three
 * questions that only exist once the engine is wired into a component with
 * five other claimants on the same keys:
 *
 * - a letter pressed in normal mode must never be typed,
 * - Esc has to reach the right owner among the palette, normal mode and the
 *   App's turn-cancel, and
 * - turning the setting off has to give the plain editor back, whole.
 * @module @deepseek-ai/dsh-tui/tests/vim-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

const ESC = String.fromCharCode(27)

/** The line inside the prompt box, with its frame and prefix stripped. */
function promptLine(screen: string): string {
  const row = screen.split('\n').find(line => /^│ (>|N) /.test(line))
  return row ?? ''
}

describe('the prompt with vim keybinds on', () => {
  it('starts in insert, so the setting does not swallow the next thing typed', async () => {
    const painted = await paintApp({ keybinds: 'vim' })
    await painted.send('git status')
    const line = promptLine(painted.screen())
    painted.unmount()

    expect(line).toContain('git status')
    expect(line).toMatch(/^│ > /)
  })

  it('marks normal mode in the buffer prefix, at no cost in rows', async () => {
    const painted = await paintApp({ keybinds: 'vim', rows: 40 })
    await painted.send('git status')
    const before = painted.screen().split('\n').length
    await painted.send(ESC)
    const after = painted.screen().split('\n')
    painted.unmount()

    // The marker changes; the frame does not get taller. A mode line under the
    // box would grow the frame on every Esc, and in a fixed-height root that
    // is how a subtree starts overlapping its neighbours.
    expect(after.length).toBe(before)
    expect(promptLine(after.join('\n'))).toMatch(/^│ N /)
  })

  it('never types a normal-mode command into the buffer', async () => {
    // The rule the whole feature rests on. Every one of these is an editor
    // command in normal mode, and a build that let one fall through to the
    // text path would append it instead.
    const painted = await paintApp({ keybinds: 'vim' })
    await painted.send('abc')
    await painted.send(ESC)
    for (const key of ['q', 'z', 'i'.toUpperCase(), 'w', 'b']) await painted.send(key)
    const line = promptLine(painted.screen())
    painted.unmount()

    expect(line).toContain('abc')
    expect(line).not.toMatch(/abc[qzWwb]/)
  })

  it('edits with a motion, then takes the change back in insert', async () => {
    const painted = await paintApp({ keybinds: 'vim' })
    await painted.send('git commit')
    await painted.send(ESC)
    await painted.send('b')     // back to the start of `commit`
    await painted.send('c')     // change…
    await painted.send('w')     // …the word
    await painted.send('push')  // typed, because `cw` returned us to insert
    const line = promptLine(painted.screen())
    painted.unmount()

    expect(line).toContain('git push')
  })

  it('gives the palette Esc ahead of normal mode', async () => {
    // A visible list is what Esc means everywhere else in this prompt, and the
    // palette is on screen: dismissing it wins over leaving insert.
    const painted = await paintApp({ keybinds: 'vim' })
    await painted.send('/mo')
    expect(painted.screen()).toContain('/model')
    await painted.send(ESC)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('/model')
    expect(promptLine(screen)).toMatch(/^│ > /)
  })

  it('sends the line on Enter and comes back in insert', async () => {
    // A vi-mode shell does the same. The next thing a user does after sending
    // is type, and charging them an `i` first would tax every message.
    const painted = await paintApp({ keybinds: 'vim' })
    await painted.send('hello')
    await painted.send(ESC)
    await painted.send('\r')
    await painted.send('again')
    const line = promptLine(painted.screen())
    painted.unmount()

    expect(line).toContain('again')
    expect(line).toMatch(/^│ > /)
  })
})

describe('the prompt with vim keybinds off', () => {
  it('types the letters a normal mode would have eaten', async () => {
    const painted = await paintApp()
    await painted.send('abc')
    await painted.send(ESC)
    await painted.send('dw')
    const line = promptLine(painted.screen())
    painted.unmount()

    expect(line).toContain('abcdw')
  })

  it('keeps the readline motions in both settings', async () => {
    // Insert mode *is* the readline editor — that is the whole design — so
    // Ctrl-A has to work identically whichever way the preference is set.
    for (const keybinds of ['default', 'vim'] as const) {
      const painted = await paintApp({ keybinds })
      await painted.send('world')
      await painted.send(String.fromCharCode(1)) // Ctrl-A
      await painted.send('hello ')
      const line = promptLine(painted.screen())
      painted.unmount()

      // The caret glyph is part of the claim: Ctrl-A had to land it at index
      // 0 for the insertion to end up before 'world' rather than after it.
      expect(line).toContain('hello ▌world')
    }
  })
})
