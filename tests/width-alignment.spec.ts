import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'
import { displayWidth } from '../src/core/width.ts'

describe('full-width interaction surfaces', () => {
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
