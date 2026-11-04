import { expect, it, vi } from 'vitest'
import { diagnosticText, installDiagnostics } from '../src/terminal/diagnostics.ts'

it('keeps routine discovery out of the UI but delivers warnings as structured notes', async () => {
  const write = vi.fn()
  const receive = vi.fn()
  const before = console.error
  const restore = installDiagnostics({ current: receive }, write)
  try {
    console.error('[llm-deepseek-api-key]', 'model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)')
    console.info('background discovery')
    console.warn('actionable warning')
    await Promise.resolve()
    expect(write).toHaveBeenCalledTimes(3)
    expect(receive).toHaveBeenCalledOnce()
    expect(receive.mock.calls[0][0]).toMatchObject({ text: 'actionable warning', level: 'warn' })
  } finally { restore() }
  expect(console.error).toBe(before)
})
it('redacts recognizable API keys before diagnostic persistence', () => {
  expect(diagnosticText(['failure sk-abcdefgh12345678'])).toBe('failure sk-…')
})
