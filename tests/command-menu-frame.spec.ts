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
