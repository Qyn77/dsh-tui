import { describe, expect, it } from 'vitest'
import { ESC, paintApp } from './fake-tty.ts'

describe('transcript browser', () => {
  it('searches, navigates into history and preserves an unfinished draft', async () => {
    const app = await paintApp({ turns: 30, rows: 24, columns: 80 })
    try {
      await app.send('unfinished draft')
      await app.send(`${ESC}OR`)
      expect(app.screen()).toContain('Search conversation')
      await app.send('answer 01')
      expect(app.screen()).toContain('2. assistant')
      await app.send('\r')
      expect(app.screen()).toContain('answer 01')
      expect(app.screen()).toContain('unfinished draft')
    } finally { app.unmount() }
  })
  it('selects a message before its action and escapes without losing the draft', async () => {
    const app = await paintApp({ turns: 4, rows: 19, columns: 60 })
    try {
      await app.send('draft')
      await app.send(`${ESC}OS`)
      expect(app.screen()).toContain('Select a message')
      await app.send('\r')
      expect(app.screen()).toContain('Message actions · 8')
      expect(app.screen()).toContain('Copy text')
      expect(app.screen().split('\n').length).toBeLessThanOrEqual(19)
      await app.send(`${ESC}[B`)
      await app.send('\r')
      expect(app.screen()).toContain('Entry 8')
      expect(app.screen()).toContain('answer 04')
      expect(app.screen()).toContain('draft')
    } finally { app.unmount() }
  })
  it('opens /search as an editable query with a non-executing empty result', async () => {
    const app = await paintApp({ turns: 1 })
    try {
      await app.send('/search impossible')
      await app.send('\r')
      expect(app.screen()).toContain('No matching messages')
      await app.send('\r')
      expect(app.screen()).toContain('Search conversation')
      await app.send(ESC)
      await app.settle(60)
      expect(app.screen()).not.toContain('Search conversation')
    } finally { app.unmount() }
  })
})
