import { expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

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
