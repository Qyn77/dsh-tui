/** Delayed plugin diagnostics must not move the cursor behind Ink's back. */
import { afterEach, expect, it, vi } from 'vitest'
import type * as Ink from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { fakeStdout, fakeTtyStdin, provideHistory, seedSession, strip } from './fake-tty.ts'

vi.mock('ink', async (original) => ({ ...await original<typeof Ink>(), render: vi.fn() }))
vi.mock('../src/terminal/settings.ts', () => ({
  readSettings: () => ({ language: 'en', theme: 'dark', history: 'show', keybinds: 'default' }),
}))

import { render } from 'ink'
import { apply, internals } from '../src/index.ts'

afterEach(() => vi.restoreAllMocks())

it('redraws the live frame after a model-listing log arriving after startup', async () => {
  const stdout = fakeStdout(120, 31)
  const stdin = fakeTtyStdin()
  vi.spyOn(process, 'stdout', 'get').mockReturnValue(stdout as never)
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(Object.assign(stdin, { fd: 0 as const }))
  // Before Ink mounts, console output writes straight to the terminal. The
  // runner must take ownership of this path as part of mounting the UI.
  vi.spyOn(console, 'error').mockImplementation((message: string) => { stdout.write(`${message}\n`) })
  const originalError = console.error
  const oldIo = { ...internals }
  internals.stdout = stdout
  internals.stderr = stdout
  const actualInk = await vi.importActual<typeof Ink>('ink')
  let instance: ReturnType<typeof render> | undefined
  vi.mocked(render).mockImplementation((node, options) => {
    instance = actualInk.render(node, { ...options as Ink.RenderOptions,
      stdout: stdout as never, stdin, stderr: stdout as never })
    return instance
  })
  const ctx = new Context()
  const session = seedSession(0)
  provideHistory(ctx, () => session)
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
  ctx.provide('agents', { create: async () => ({ agent: {
    id: session.id, session, status: 'idle', on: () => () => {},
  } }) } as never)
  ctx.provide('appExit', vi.fn() as never)
  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 100))
  try {
    apply(ctx, {})
    await settle()
    expect(instance).toBeDefined()
    const marker = '[llm-deepseek-api-key] model listing loaded 2 models'
    console.error(marker)
    await settle()
    stdin.send('/')
    await settle()
    const output = stdout.frames.join('')
    const logAt = output.indexOf(marker)
    expect(logAt).toBeGreaterThan(-1)
    // A managed log clears the old frame BEFORE the diagnostic, then redraws
    // it immediately. Waiting for the next key leaves the old top border.
    expect(output.slice(logAt + marker.length).split('/approval')[0]).toContain('╭')
    const diagnostic = stdout.frames.findIndex(chunk => chunk.includes(marker))
    expect(stdout.frames[diagnostic - 1]).toContain('\u001B[2K')
    expect(strip(stdout.frames[diagnostic + 1] ?? '')).toContain('Ask dsh anything')
  } finally {
    instance?.unmount()
    await settle()
    expect(console.error).toBe(originalError)
    Object.assign(internals, oldIo)
  }
})
