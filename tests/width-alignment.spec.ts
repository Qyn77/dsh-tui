import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'
import { displayWidth } from '../src/core/width.ts'

describe('full-width interaction surfaces', () => {
  it('keeps emoji and combining text intact without shortening the prompt border', async () => {
    const tty = await paintApp({ columns: 60, rows: 24 })
    try {
      await tty.send('a👨‍👩‍👧‍👦e\u0301z')
      const lines = tty.screen().slice(tty.screen().lastIndexOf('╭')).split('\n')
      const row = lines.find(line => line.includes('a👨')) ?? ''
      expect(row).toContain('a👨‍👩‍👧‍👦e\u0301z')
      expect(displayWidth(row)).toBe(displayWidth(lines[0]))
    } finally { tty.unmount() }
  })
  it.each([60, 90, 120])('keeps picker borders aligned with the input at %i columns', async (columns) => {
    const tty = await paintApp({ columns, rows: 40 })
    try {
      for (const input of ['/', 'h']) {
        await tty.send(input)
        const borders = tty.screen().split('\n').filter(line => line.startsWith('╭'))
        expect(borders.length).toBeGreaterThanOrEqual(2)
        expect(displayWidth(borders.at(-2) ?? '')).toBe(displayWidth(borders.at(-1) ?? ''))
      }
    } finally { tty.unmount() }
  })

  it.each([60, 120])('fills the transcript column for short user messages at %i columns', async (columns) => {
    const tty = await paintApp({ columns, rows: 40, turns: 1 })
    try {
      const frame = tty.screen().split('\n').find(line => line.includes('╭') && !line.startsWith('╭'))
      expect(displayWidth(frame?.slice(frame.indexOf('╭')).trimEnd() ?? '')).toBeGreaterThanOrEqual(columns - 6)
    } finally { tty.unmount() }
  })
})
