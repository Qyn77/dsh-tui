import { describe, expect, it } from 'vitest'
import { ESC, paintApp } from './fake-tty.ts'

describe('command menu keyboard flow', () => {
  it('opens known settings, filters, fills with Tab and executes only on Enter', async () => {
    const app = await paintApp()
    try {
      await app.send('/theme')
      await app.send('\r')
      expect(app.screen()).toContain('Automatic')
      expect(app.screen()).toContain('Esc back')
      await app.send('light')
      await app.send('\t')
      expect(app.screen()).toContain('/theme light')
      expect(app.screen()).not.toContain('Esc back')
      await app.send('\r')
      expect(app.screen()).toContain('light')
    } finally { app.unmount() }
  })
  it('keeps a no-match page non-executable and Esc clears filter then dismisses', async () => {
    const app = await paintApp()
    try {
      await app.send('/language ')
      await app.send('missing-language')
      await app.send('\r')
      expect(app.screen()).toContain('No matching choices')
      await app.send(ESC)
      await app.settle(60)
      expect(app.screen()).toContain('English')
      await app.send(ESC)
      await app.settle(60)
      expect(app.screen()).not.toContain('Esc back')
      expect(app.screen()).toContain('/language')
    } finally { app.unmount() }
  })
})

it('navigates multiple levels and returns without running a session action', async () => {
  const app = await paintApp()
  try {
    await app.send('/sessions')
    await app.send('\r')
    await app.send('rename')
    await app.send('\r')
    expect(app.screen()).toContain('Current')
    await app.send('\r')
    expect(app.screen()).toContain('Enter a new title')
    await app.send(ESC)
    await app.settle(60)
    expect(app.screen()).toContain('Current')
    await app.send('\r')
    await app.send('\r')
    expect(app.screen()).toContain('/sessions rename current')
    expect(app.screen()).not.toContain('Esc back')
  } finally { app.unmount() }
})
it('keeps long lists inside a short narrow terminal and inspection uses the selected entry', async () => {
  const app = await paintApp({ turns: 25, rows: 19, columns: 70 })
  try {
    await app.send('/inspect')
    await app.send('\r')
    expect(app.screen()).toContain('answer 25')
    expect(app.screen().split('\n').length).toBeLessThanOrEqual(19)
    await app.send('\r')
    expect(app.screen()).toContain('Entry 50')
    expect(app.screen()).toContain('answer 25')
  } finally { app.unmount() }
})
it('keeps text arguments editable and complete typed commands working', async () => {
  const app = await paintApp()
  try {
    await app.send('/export ')
    await app.send('\r')
    await app.send('a path with spaces.md')
    expect(app.screen()).toContain('/export a path with spaces.md')
    expect(app.screen()).not.toContain('No matching choices')
    await app.send('\x03')
    await app.send('/mouse off')
    await app.send('\r')
    expect(app.screen()).toContain('off')
    expect(app.screen()).not.toContain('Esc back')
  } finally { app.unmount() }
})
it('accepts known command syntax typed after opening a menu', async () => {
  const app = await paintApp()
  try {
    await app.send('/sessions ')
    await app.send('favorite current on')
    await app.send('\r')
    expect(app.screen()).not.toContain('No matching choices')
    // This fixture has no session library; reaching dispatch must report that fact.
    expect(app.screen()).toContain('unavailable')
  } finally { app.unmount() }
})
