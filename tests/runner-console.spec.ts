/** Delayed plugin diagnostics must not move the cursor behind Ink's back. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type * as Ink from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { fakeStdout, fakeTtyStdin, provideHistory, seedSession, strip } from './fake-tty.ts'

vi.mock('ink', async original => ({ ...await original<typeof Ink>(), render: vi.fn() }))
vi.mock('../src/terminal/settings.ts', () => ({
  readSettings: () => ({ language: 'en', theme: 'dark', history: 'show', keybinds: 'default' }),
}))

import { render } from 'ink'
import { apply, internals } from '../src/index.ts'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it('keeps a provider warning inside the live frame after startup', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-diagnostics-'))
  vi.stubEnv('DSH_HOME', home)
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
    const marker = '[llm-deepseek-api-key] model listing failed temporarily'
    console.error(marker)
    await settle()
    stdin.send('/')
    await settle()
    const output = stdout.frames.join('')
    const logAt = output.indexOf(marker)
    expect(logAt).toBeGreaterThan(-1)
    const diagnosticFrame = stdout.frames.find(chunk => chunk.includes(marker)) ?? ''
    expect(diagnosticFrame).toContain('╭')
    expect(diagnosticFrame).toContain('Ask dsh anything')
    expect(strip(diagnosticFrame)).toContain(marker)

  } finally {
    instance?.unmount()
    await settle()
    expect(console.error).toBe(originalError)
    Object.assign(internals, oldIo)
    rmSync(home, { recursive: true, force: true })
  }
})

it('switches sequential tabs transactionally and releases each previous handle', async () => {
  const { Session, SessionId } = await import('@deepseek-ai/dsh-session')
  const home = mkdtempSync(join(tmpdir(), 'dsh-tabs-'))
  vi.stubEnv('DSH_HOME', home)
  const stdout = fakeStdout(100, 31), stdin = fakeTtyStdin()
  vi.spyOn(process, 'stdout', 'get').mockReturnValue(stdout as never)
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(Object.assign(stdin, { fd: 0 as const }))
  const oldIo = { ...internals }; internals.stdout = stdout; internals.stderr = stdout
  let props: import('../src/renderer.tsx').AppProps | undefined
  let stop: () => void = () => {}
  const finished = new Promise<void>((resolve) => { stop = resolve })
  const capture = (node: React.ReactNode) => { props = (node as React.ReactElement<import('../src/renderer.tsx').AppProps>).props }
  vi.mocked(render).mockImplementation((node) => {
    capture(node)
    return { clear: () => {}, cleanup: () => {}, rerender: capture, unmount: () => {}, waitUntilExit: () => finished }
  })
  const sessions = new Map<string, ReturnType<typeof Session.create>>()
  const dispose = vi.fn(async () => {})
  let current: { status: string } | undefined
  const handle = (id: string) => {
    const session = sessions.get(id) ?? Session.create(SessionId(id))
    sessions.set(id, session)
    const agent = { id: session.id, session, status: 'idle', on: () => () => {} }
    current = agent
    return { agent, dispose }
  }
  const ctx = new Context()
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
  ctx.provide('agents', { create: async (options: { sessionId: string }) => handle(options.sessionId),
    resume: async (options: { resumeSessionId: string }) => handle(options.resumeSessionId) } as never)
  ctx.provide('sessionPersistence', { list: async () => [...sessions.values()].map(session => ({ header: session.header })) } as never)
  ctx.provide('appExit', vi.fn() as never)
  try {
    apply(ctx, {})
    await new Promise(resolve => setTimeout(resolve, 100))
    const first = props!.agent.id
    expect(await props!.tabs!.run('new')).toMatchObject({ kind: 'switched' })
    const second = props!.agent.id
    expect(second).not.toBe(first)
    expect(props!.tabs!.ids).toEqual([first, second])
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(await props!.tabs!.run('prev')).toMatchObject({ kind: 'switched', id: first })
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(await props!.tabs!.run('close')).toMatchObject({ kind: 'switched', id: second })
    expect(props!.tabs!.ids).toEqual([second])
    expect(sessions.has(first)).toBe(true)
    expect(await props!.tabs!.run('close')).toMatchObject({ kind: 'current' })
    current!.status = 'running'
    expect(await props!.tabs!.run('new')).toEqual({ kind: 'busy' })
  } finally {
    stop(); await new Promise(resolve => setTimeout(resolve, 50))
    Object.assign(internals, oldIo); rmSync(home, { recursive: true, force: true })
  }
})
