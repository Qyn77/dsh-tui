/**
 * Slash command dispatch. The commands run synchronously against a real Cordis
 * context (minimal: only the services each command consults) and a real
 * Agent-shaped stand-in, then assert the `CommandResult` and the recorded
 * process effects.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
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

  it('returns handled with the help text for /help', () => {
    const { cmd } = makeCommand()
    const result = dispatch('/help', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toMatch(/Available commands/)
      expect(result.message).toMatch(/\/exit/)
    }
  })

  it('clears the visible view for /clear', () => {
    const { cmd, reset } = makeCommand()
    const result = dispatch('/clear', cmd)
    expect(result.kind).toBe('handled')
    expect(reset).toHaveBeenCalledOnce()
    // Silent on purpose: command output is an entry in the log, so any
    // message here would leave the log one entry long and suppress the
    // banner the empty log is supposed to bring back.
    if (result.kind === 'handled') expect(result.message).toBeUndefined()
  })

  it('reports the current model and session for /status', () => {
    const { cmd } = makeCommand()
    const result = dispatch('/status', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toContain('test-provider/test-model')
      expect(result.message).toContain('tui-1')
    }
  })

  it('reports the model as unknown when no default-model service is mounted', () => {
    // `service()` returns `undefined` for a service nobody provided, and that is
    // legitimate: a bare `dsh-tui` in a harness has no `agentDefaultModel`.
    // `/status` has to degrade to a word rather than print `undefined/undefined`.
    const ctx = new Context()
    const cmd: CommandContext = {
      ctx,
      agent: { id: 'tui-1' as never, session: undefined as never } as never,
      resetView: vi.fn(),
    }
    const result = dispatch('/status', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toContain('model: unknown')
      expect(result.message).toContain('tui-1')
    }
  })

  it('asks the launcher to exit for /exit and /quit (case + trailing whitespace)', () => {
    const { cmd, reset: resetA } = makeCommand()
    expect(dispatch('/exit', cmd).kind).toBe('exit')

    const { cmd: cmdB } = makeCommand()
    expect(dispatch('/quit', cmdB).kind).toBe('exit')
    expect(dispatch('/QUIT  ', cmdB).kind).toBe('exit')

    // The first command was /exit (no clear), so its resetter was untouched.
    expect(resetA).not.toHaveBeenCalled()
  })

  it('returns unknown for unrecognised commands', () => {
    const { cmd } = makeCommand()
    const result = dispatch('/fly', cmd)
    expect(result).toEqual({ kind: 'unknown', input: '/fly' })
  })

  it('falls back to process.exit when no appExit is provided', () => {
    const ctx = makeStandWithoutExit()
    const reset = vi.fn()
    const cmd: CommandContext = {
      ctx,
      agent: { id: 'tui-1' as never, session: undefined as never } as never,
      resetView: reset,
    }
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    const result = dispatch('/exit', cmd)
    expect(result.kind).toBe('exit')
    expect(exitSpy).toHaveBeenCalledWith(0)
    // resetView was never called — the command was an exit, not a clear.
    expect(reset).not.toHaveBeenCalled()
  })
})

describe('filterCommands', () => {
  it('returns every command when the buffer is just `/`', () => {
    const result = filterCommands('/').map(c => c.name)
    expect(result).toEqual(['/clear', '/exit', '/help', '/quit', '/status'])
  })

  it('filters to commands whose names start with the buffer (case-insensitive)', () => {
    const result = filterCommands('/h').map(c => c.name)
    expect(result).toEqual(['/help'])
  })

  it('matches /quit under /Q prefix', () => {
    const result = filterCommands('/Q').map(c => c.name)
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
    const result = filterCommands('/').map(c => c.name)
    const sorted = [...result].sort((a, b) => a.localeCompare(b))
    expect(result).toEqual(sorted)
  })
})
