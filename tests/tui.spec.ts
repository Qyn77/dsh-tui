/**
 * Plugin shape, type helpers, and apply() wiring. The Ink render itself
 * needs a real TTY; that path is covered by a manual smoke (`pnpm dsh
 * --profile tui` in a terminal). Here we lock the public exports and verify
 * the runner refuses to render without one and reports it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { isRenderable, userMessageText } from '../src/core/types.ts'
import { apply, Config, internals, name } from '../src/index.ts'

describe('tui plugin shape', () => {
  it('exports the stable Cordis plugin name and accepts an empty config', () => {
    expect(name).toBe('tui-runner')
    expect(new Config({})).toEqual({})
  })

  it('exposes internals streams for tests to substitute', () => {
    expect(internals.stdout).toBeDefined()
    expect(internals.stderr).toBeDefined()
  })
})

describe('ui type helpers', () => {
  it('extracts the visible text of a user message', () => {
    const msg = createUserMessage({
      content: [{ type: 'text', text: 'hello world' }],
      source: { kind: 'user' },
    })
    expect(userMessageText(msg)).toBe('hello world')
  })

  it('marks the events the TUI cares about as renderable', () => {
    const renderableTypes = [
      'turn/start', 'turn/end', 'step/start', 'step/end',
      'user/message', 'assistant/attempt', 'assistant/message',
      'tool/call', 'tool/result',
      'compaction/start', 'compaction/end', 'compaction/summary', 'compaction/prune',
      'plan/mode', 'agent/inbox/spliced',
    ] as const
    for (const type of renderableTypes) {
      // isRenderable only reads `type`; the data shape is irrelevant.
      const ev = { type, seq: 0, time: 0, data: {} } as unknown as SessionEvent
      expect(isRenderable(ev)).toBe(true)
    }
    // An event outside the rendered set is filtered out.
    const unknown = { type: 'unknown/event', seq: 0, time: 0, data: {} } as unknown as SessionEvent
    expect(isRenderable(unknown)).toBe(false)
    // `session/end-seed` is log bookkeeping — the reducer has no case for it,
    // so letting it through the filter would be work that draws nothing.
    const endSeed = { type: 'session/end-seed', seq: 0, time: 0, data: {} } as unknown as SessionEvent
    expect(isRenderable(endSeed)).toBe(false)
  })
})

describe('tui runner apply()', () => {
  const originalInternals = { stdout: internals.stdout, stderr: internals.stderr }
  afterEach(() => {
    internals.stdout = originalInternals.stdout
    internals.stderr = originalInternals.stderr
    vi.restoreAllMocks()
  })

  it('refuses a Windows legacy console before creating an agent or changing terminal modes', async () => {
    const ctx = new Context()
    const create = vi.fn()
    ctx.provide('agentDefaultModel', {} as never)
    ctx.provide('sessions', {} as never)
    ctx.provide('agents', { create } as never)
    const exit = vi.fn()
    ctx.provide('appExit', exit)
    let err = ''
    internals.stderr = { write: (chunk: string) => { err += chunk } }
    const write = vi.fn()
    internals.stdout = { write }
    const values = [[process, 'platform'], [process.stdin, 'isTTY'], [process.stdout, 'isTTY']] as const
    const descriptors = values.map(([object, key]) => Object.getOwnPropertyDescriptor(object, key))
    vi.stubEnv('WT_SESSION', '')
    vi.stubEnv('DSH_TUI_TERMINAL', 'windows-terminal')
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
      apply(ctx, {})
      await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(1) })
      expect(err).toContain('Windows Terminal')
      expect(create).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    } finally {
      values.forEach(([object, key], index) => {
        const descriptor = descriptors[index]
        if (descriptor) Object.defineProperty(object, key, descriptor)
        else Reflect.deleteProperty(object, key)
      })
      vi.unstubAllEnvs()
      await ctx.fiber.dispose()
    }
  })

  it('refuses to render without a TTY and routes the failure through stderr and appExit', async () => {
    // Provide a minimal set of services the runner consults before
    // inkRender is reached. The loader await returns immediately; the
    // agents service resolves to a no-op agent.
    const ctx = new Context()
    let release: () => void = () => {}
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'p', model: 'm' }),
    } as never)
    ctx.provide('sessions', {} as never)
    const agent = {
      id: 'tui-stub' as never,
      session: { id: 'tui-stub' as never, events: [] },
      status: 'idle',
      cancel: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => {},
      whenIdle: () => Promise.resolve(),
      on: () => () => {},
    }
    ctx.provide('agents', {
      create: () => Promise.resolve({ agent, dispose: () => Promise.resolve() }),
    } as never)
    // Capture exits routed through the launcher so the runner's catch
    // path never falls back to `process.exit` (which vitest intercepts
    // and treats as an unhandled error).
    const exits: number[] = []
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    let err = ''
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    internals.stdout = { write: () => true }
    // vitest's stdin is a pipe, so the runner's TTY precondition trips.
    // That precondition exists because Ink cannot be relied on to report
    // it: `useInput` throws from a passive effect, and `<Static>` (the
    // banner) makes React swallow errors thrown there. Asserting our own
    // failure path keeps that guarantee from rotting — a silent hang is
    // what the alternative looks like.
    apply(ctx, {})
    release()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(err).toMatch(/not a TTY/i)
    expect(exits).toEqual([1])
    await ctx.fiber.dispose()
  })
})
