/**
 * Slash command dispatch. The commands run against a real Cordis context
 * (minimal: only the services each command consults) and a real
 * Agent-shaped stand-in, then assert the `CommandResult` and the recorded
 * process effects. `dispatch` is async because `/model` reads provider
 * catalogs, so every case awaits — even the ones that do no I/O.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { dispatch, filterCommands, type CommandContext } from '../src/commands.ts'

interface Stand {
  ctx: Context
  exits: number[]
}

function makeStand(): Stand {
  const ctx = new Context()
  const exits: number[] = []
  ctx.provide('appExit', (code: number) => { exits.push(code) })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
  } as never)
  return { ctx, exits }
}

function makeCommand(overrides?: Partial<CommandContext>): { cmd: CommandContext; reset: ReturnType<typeof vi.fn> } {
  const stand = makeStand()
  const reset = vi.fn()
  const cmd: CommandContext = {
    ctx: stand.ctx,
    agent: { id: 'tui-1' as never, session: undefined as never } as never,
    resetView: reset,
    ...overrides,
  }
  return { cmd, reset }
}

/**
 * Build a CommandContext whose `ctx` has no `appExit` service registered.
 * Cordis `Context` has no public unregister for provided services, so we
 * construct a separate `Context` and only install the services the dispatch
 * path consults before falling back to `process.exit`.
 */
function makeStandWithoutExit(): Context {
  const ctx = new Context()
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
  } as never)
  return ctx
}

describe('slash command dispatch', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('returns handled with the help text for /help', async () => {
    const { cmd } = makeCommand()
    const result = await dispatch('/help', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toMatch(/Available commands/)
      expect(result.message).toMatch(/\/exit/)
    }
  })

  it('clears the visible view for /clear', async () => {
    const { cmd, reset } = makeCommand()
    const result = await dispatch('/clear', cmd)
    expect(result.kind).toBe('handled')
    expect(reset).toHaveBeenCalledOnce()
  })

  it('reports the current model and session for /status', async () => {
    const { cmd } = makeCommand()
    const result = await dispatch('/status', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toContain('test-provider/test-model')
      expect(result.message).toContain('tui-1')
    }
  })

  it('asks the launcher to exit for /exit and /quit (case + trailing whitespace)', async () => {
    const { cmd, reset: resetA } = makeCommand()
    expect((await dispatch('/exit', cmd)).kind).toBe('exit')

    const { cmd: cmdB } = makeCommand()
    expect((await dispatch('/quit', cmdB)).kind).toBe('exit')
    expect((await dispatch('/QUIT  ', cmdB)).kind).toBe('exit')

    // The first command was /exit (no clear), so its resetter was untouched.
    expect(resetA).not.toHaveBeenCalled()
  })

  it('returns unknown for unrecognised commands', async () => {
    const { cmd } = makeCommand()
    const result = await dispatch('/fly', cmd)
    expect(result).toEqual({ kind: 'unknown', input: '/fly' })
  })

  it('falls back to process.exit when no appExit is provided', async () => {
    const ctx = makeStandWithoutExit()
    const reset = vi.fn()
    const cmd: CommandContext = {
      ctx,
      agent: { id: 'tui-1' as never, session: undefined as never } as never,
      resetView: reset,
    }
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    const result = await dispatch('/exit', cmd)
    expect(result.kind).toBe('exit')
    expect(exitSpy).toHaveBeenCalledWith(0)
    // resetView was never called — the command was an exit, not a clear.
    expect(reset).not.toHaveBeenCalled()
  })
})

describe('/model', () => {
  /**
   * A context with an `llm` runtime advertising two providers, one of
   * which lists nothing, plus a default-model service that records what
   * it was asked to save.
   */
  function makeModelStand(options?: { saveFails?: boolean }) {
    const ctx = new Context()
    const saved: unknown[] = []
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek', model: 'v4-flash' }),
      saveSelection: async (next: unknown) => {
        if (options?.saveFails === true) throw new Error('no settings provider')
        saved.push(next)
      },
    } as never)
    ctx.provide('llm', {
      listProviders: () => [
        { id: 'deepseek', name: 'DeepSeek' },
        { id: 'quiet', name: 'Quiet' },
        { id: 'broken', name: 'Broken' },
      ],
      listModels: async (provider: string) => {
        if (provider === 'broken') throw new Error('endpoint unreachable')
        if (provider === 'quiet') return []
        return [
          { provider, id: 'v4-flash', name: 'V4 Flash' },
          { provider, id: 'v4-reasoner', name: 'V4 Reasoner' },
        ]
      },
    } as never)
    const selectionRef: ModelSelectionRef = {
      current: { provider: 'deepseek', model: 'v4-flash' },
      assembled: undefined,
    }
    const cmd: CommandContext = {
      ctx,
      agent: { id: 'tui-1' as never, session: undefined as never } as never,
      resetView: vi.fn(),
      selectionRef,
    }
    return { cmd, saved, selectionRef }
  }

  it('lists the catalog and marks the current model when given no argument', async () => {
    const { cmd } = makeModelStand()
    const result = await dispatch('/model', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toContain('current: deepseek/v4-flash')
      expect(result.message).toContain('v4-reasoner')
      expect(result.message).toContain('/model <provider>/<model>')
      // No switch happened, so the UI has nothing to re-read.
      expect(result.selection).toBeUndefined()
    }
  })

  it('survives one provider whose catalog endpoint fails', async () => {
    // One broken adapter should cost the user that provider's rows, not
    // the whole listing.
    const { cmd } = makeModelStand()
    const result = await dispatch('/model', cmd)
    if (result.kind === 'handled') {
      expect(result.message).toContain('v4-reasoner')
      expect(result.message).toContain('broken')
    }
  })

  it('switches the live agent and saves the new default', async () => {
    const { cmd, saved, selectionRef } = makeModelStand()
    const result = await dispatch('/model deepseek/v4-reasoner', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toContain('deepseek/v4-flash → deepseek/v4-reasoner')
      expect(result.selection).toEqual({ provider: 'deepseek', model: 'v4-reasoner' })
    }
    // Writing the ref is what re-routes the running agent; saving the
    // setting only affects the next launch. Both must happen.
    expect(selectionRef.current).toEqual({ provider: 'deepseek', model: 'v4-reasoner' })
    expect(saved).toEqual([{ provider: 'deepseek', model: 'v4-reasoner' }])
  })

  it('switches on a bare model id when only one provider advertises it', async () => {
    const { cmd, selectionRef } = makeModelStand()
    await dispatch('/model v4-reasoner', cmd)
    expect(selectionRef.current?.provider).toBe('deepseek')
    expect(selectionRef.current?.model).toBe('v4-reasoner')
  })

  it('warns but still switches for a model absent from the catalog', async () => {
    const { cmd, selectionRef } = makeModelStand()
    const result = await dispatch('/model quiet/some-preview', cmd)
    if (result.kind === 'handled') {
      expect(result.message).toContain('not in quiet\'s advertised catalog')
    }
    expect(selectionRef.current).toEqual({ provider: 'quiet', model: 'some-preview' })
  })

  it('refuses an unregistered provider and changes nothing', async () => {
    const { cmd, saved, selectionRef } = makeModelStand()
    const result = await dispatch('/model nope/v4-flash', cmd)
    if (result.kind === 'handled') {
      expect(result.message).toContain('unknown provider: nope')
      expect(result.selection).toBeUndefined()
    }
    expect(selectionRef.current).toEqual({ provider: 'deepseek', model: 'v4-flash' })
    expect(saved).toEqual([])
  })

  it('reports a failed save instead of claiming success', async () => {
    // A user told "switched" who finds the old model back after a
    // restart has been lied to.
    const { cmd, selectionRef } = makeModelStand({ saveFails: true })
    const result = await dispatch('/model deepseek/v4-reasoner', cmd)
    if (result.kind === 'handled') {
      expect(result.message).toContain('→ deepseek/v4-reasoner')
      expect(result.message).toContain('not saved as the default')
      expect(result.message).toContain('no settings provider')
    }
    // The live switch still stands; only persistence failed.
    expect(selectionRef.current?.model).toBe('v4-reasoner')
  })

  it('drops the reasoning effort across a switch and says so', async () => {
    // Effort ids are adapter-owned and scoped to one exact route, so
    // carrying one onto a different model is at best rejected.
    const { cmd, selectionRef } = makeModelStand()
    selectionRef.current = {
      provider: 'deepseek',
      model: 'v4-flash',
      reasoningEffort: 'high' as never,
    }
    const result = await dispatch('/model deepseek/v4-reasoner', cmd)
    if (result.kind === 'handled') {
      expect(result.message).toContain('reasoning effort reset')
    }
    expect(selectionRef.current?.reasoningEffort).toBeUndefined()
  })

  it('reads the live ref, not the saved default, for the current model', async () => {
    // The two diverge the moment a save fails; the ref is what the
    // agent actually routes to.
    const { cmd, selectionRef } = makeModelStand()
    selectionRef.current = { provider: 'quiet', model: 'drifted' }
    const result = await dispatch('/status', cmd)
    if (result.kind === 'handled') expect(result.message).toContain('quiet/drifted')
  })

  it('says so when the deployment has no model service at all', async () => {
    const cmd: CommandContext = {
      ctx: new Context(),
      agent: { id: 'tui-1' as never, session: undefined as never } as never,
      resetView: vi.fn(),
    }
    const result = await dispatch('/model', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') expect(result.message).toContain('unavailable')
  })
})

describe('filterCommands', () => {
  it('returns every command when the buffer is just `/`', () => {
    const result = filterCommands('/').map((c) => c.name)
    expect(result).toEqual(['/clear', '/exit', '/help', '/model', '/quit', '/status'])
  })

  it('filters to commands whose names start with the buffer (case-insensitive)', () => {
    const result = filterCommands('/h').map((c) => c.name)
    expect(result).toEqual(['/help'])
  })

  it('matches /quit under /Q prefix', () => {
    const result = filterCommands('/Q').map((c) => c.name)
    expect(result).toEqual(['/quit'])
  })

  it('returns an empty list when no command matches', () => {
    expect(filterCommands('/xyz')).toEqual([])
  })

  it('returns an empty list when the buffer does not start with `/`', () => {
    // The palette must not show for non-slash input — that would be
    // a UX bug. Anything else is filtered out.
    expect(filterCommands('hello')).toEqual([])
    expect(filterCommands('  /help')).toEqual([])
  })

  it('always returns results sorted alphabetically', () => {
    // Order is independent of the registry's source order; we use
    // `localeCompare` so the result is stable across runs.
    const result = filterCommands('/').map((c) => c.name)
    const sorted = [...result].sort((a, b) => a.localeCompare(b))
    expect(result).toEqual(sorted)
  })
})
