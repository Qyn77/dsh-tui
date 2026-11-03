import { expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

it('navigates to old content and inspects it without losing the transcript', async () => {
  const tty = await paintApp({ turns: 40, rows: 30 })
  const submit = async (text: string): Promise<void> => { await tty.send(text); await tty.send('\r') }
  try {
    await submit('/jump 1')
    expect(tty.screen()).toContain('question 01')
    await submit('/inspect 2')
    expect(tty.screen()).toContain('Entry 2')
    expect(tty.screen()).toContain('answer 01')
    await tty.send('\u001B')
    expect(tty.screen()).not.toContain('Entry 2')
    await submit('/search answer 20')
    expect(tty.screen()).toContain('40. assistant')
  } finally { tty.unmount() }
})
