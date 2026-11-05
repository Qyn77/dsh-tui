import { expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'
import { contentGrowth } from '../src/hooks/useMessageListScroll.ts'
import { estimateEntryRows } from '../src/render/scroll.ts'

it('keeps the same history text visible while a new response grows below it', async () => {
  const tty = await paintApp({ turns: 40, rows: 30 })
  const history = (): string[] => tty.screen().split('\n').filter(line => /question \d+|answer \d+/.test(line))
  try {
    await tty.send('\u001B[5~')
    const before = history()
    expect(before.length).toBeGreaterThan(0)
    await tty.append('turn/start', { turn: 41 })
    await tty.stream('new line\n'.repeat(15), { turn: 41 })
    expect(history().slice(0, before.length)).toEqual(before)
  } finally { tty.unmount() }
})


it('removes measured window changes from the growth of mounted content', () => {
  const old = { start: 10, heights: [3, 5, 4] }
  // Two rows of output grow while an old entry is unmounted.
  expect(contentGrowth(12, 11, old, { start: 11, heights: [5, 6] })).toBe(2)
  // The window grows upward without any output change.
  expect(contentGrowth(9, 12, { start: 11, heights: [5, 4] }, old)).toBe(0)
  // Measurement changes count even when the estimate happens not to change.
  expect(contentGrowth(12, 14, old, { start: 10, heights: [3, 5, 6] })).toBe(2)
})

it('keeps history in place when streaming markdown changes rendered height', async () => {
  const tty = await paintApp({ turns: 40, rows: 30 })
  const history = (): string[] => tty.screen().split('\n').filter(line => /question \d+|answer \d+/.test(line))
  try {
    await tty.send('\u001B[5~')
    await tty.append('turn/start', { turn: 41 })
    await tty.stream('``', { turn: 41 })
    const before = history()
    const beforeOffset = Number(tty.screen().match(/↓ (\d+) more rows? below/)?.[1])
    const entry = { kind: 'assistant' as const, text: '``', turn: 41, step: 1, finalized: false }
    expect(estimateEntryRows(entry, 100)).toBe(estimateEntryRows({ ...entry, text: '```' }, 100))
    await tty.stream('`', { turn: 41 })
    expect(Number(tty.screen().match(/↓ (\d+) more rows? below/)?.[1])).toBeGreaterThan(beforeOffset)
    expect(history()).toEqual(before)
  } finally { tty.unmount() }
})
