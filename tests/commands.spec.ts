/**
 * Slash command dispatch. The commands run asynchronously against a real Cordis
 * context (minimal: only the services each command consults) and a real
 * Agent-shaped stand-in, then assert the `CommandResult` and the recorded
 * process effects.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { dispatch, filterCommands, registryCommands, type CommandContext } from '../src/commands.ts'
import type { UiState } from '../src/types.ts'

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

function emptyState(): UiState {
  return { entries: [], status: 'idle', currentTurn: 0 }
}

/**
 * A real `Session`, because `/context` reads `requestContext()` off it. The
 * other commands never touch the session, but `Agent.session` is not optional
 * in the type — an agent stand-in without one would only be papering over the
 * cast, and `/context` would crash on it exactly as it did the first time.
 */
function makeSession(): Session {
  return Session.create(SessionId('tui-test'))
}

function makeCommand(overrides?: Partial<CommandContext>): { cmd: CommandContext; reset: ReturnType<typeof vi.fn> } {
  const stand = makeStand()
  const reset = vi.fn()
  const cmd: CommandContext = {
    ctx: stand.ctx,
    agent: { id: 'tui-1' as never, session: makeSession() } as never,
    resetView: reset,
    setModel: vi.fn().mockResolvedValue(undefined),
    refreshSelection: vi.fn(),
    state: emptyState(),
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
    // Silent on purpose: command output is an entry in the log, so any
    // message here would leave the log one entry long and suppress the
    // banner the empty log is supposed to bring back.
    if (result.kind === 'handled') expect(result.message).toBeUndefined()
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

  it('reports the model as unknown when no default-model service is mounted', async () => {
    // `service()` returns `undefined` for a service nobody provided, and that is
    // legitimate: a bare `dsh-tui` in a harness has no `agentDefaultModel`.
    // `/status` has to degrade to a word rather than print `undefined/undefined`.
    const ctx = new Context()
    const cmd: CommandContext = {
      ctx,
      agent: { id: 'tui-1' as never, session: makeSession() } as never,
      resetView: vi.fn(),
      setModel: vi.fn().mockResolvedValue(undefined),
      refreshSelection: vi.fn(),
      state: emptyState(),
    }
    const result = await dispatch('/status', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind === 'handled') {
      expect(result.message).toContain('model: unknown')
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

  describe('plugin command registry fall-through', () => {
    /**
     * Stand in for `ctx.commands`. Only `execute` is exercised: the fall-through
     * hands the whole line over and reads back a `CommandExecution`, so the
     * registry's parsing and logging are its own business, not this surface's.
     */
    function withRegistry(execute: (line: string) => unknown): CommandContext {
      const { cmd } = makeCommand()
      cmd.ctx.provide('commands', {
        execute: (_agent: unknown, line: string) => Promise.resolve(execute(line)),
      } as never)
      return cmd
    }

    it('routes a name the built-in table does not own to the registry', async () => {
      const lines: string[] = []
      const cmd = withRegistry((line) => {
        lines.push(line)
        return { commandId: 'c1', result: { kind: 'success', text: 'compacted 12 nodes' } }
      })
      const result = await dispatch('/compact', cmd)
      // The whole line, leading slash included — `execute` parses it itself.
      expect(lines).toEqual(['/compact'])
      expect(result).toEqual({ kind: 'handled', message: 'compacted 12 nodes' })
    })

    it('passes the argument text through untouched', async () => {
      const lines: string[] = []
      const cmd = withRegistry((line) => {
        lines.push(line)
        return { commandId: 'c1', result: { kind: 'success' } }
      })
      await dispatch('/goal  ship the thing', cmd)
      expect(lines).toEqual(['/goal  ship the thing'])
    })

    it('marks a registry error as a failed outcome rather than an unknown command', async () => {
      // The distinction is what the view renders: a command that ran and failed
      // gets its own message, an unrecognised one gets "unknown command".
      const cmd = withRegistry(() => ({
        commandId: 'c1',
        result: { kind: 'error', text: 'nothing useful to compact' },
      }))
      const result = await dispatch('/compact', cmd)
      expect(result).toEqual({ kind: 'handled', message: 'nothing useful to compact', failed: true })
    })

    it('stays unknown when the registry does not resolve the name either', async () => {
      const cmd = withRegistry(() => undefined)
      const result = await dispatch('/fly', cmd)
      expect(result).toEqual({ kind: 'unknown', input: '/fly' })
    })

    it('keeps a built-in name out of the registry', async () => {
      // `/clear` is the TUI's own view state; a registry that also defined it
      // must not shadow the local handler.
      const lines: string[] = []
      const cmd = withRegistry((line) => {
        lines.push(line)
        return { commandId: 'c1', result: { kind: 'success', text: 'from the registry' } }
      })
      const result = await dispatch('/clear', cmd)
      expect(lines).toEqual([])
      expect(result).toEqual({ kind: 'handled' })
    })
  })

  it('falls back to process.exit when no appExit is provided', async () => {
    const ctx = makeStandWithoutExit()
    const reset = vi.fn()
    const cmd: CommandContext = {
      ctx,
      agent: { id: 'tui-1' as never, session: makeSession() } as never,
      resetView: reset,
      setModel: vi.fn().mockResolvedValue(undefined),
      refreshSelection: vi.fn(),
      state: emptyState(),
    }
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    const result = await dispatch('/exit', cmd)
    expect(result.kind).toBe('exit')
    expect(exitSpy).toHaveBeenCalledWith(0)
    // resetView was never called — the command was an exit, not a clear.
    expect(reset).not.toHaveBeenCalled()
  })

  describe('/model', () => {
    it('shows usage and current model when no argument is given', async () => {
      const { cmd } = makeCommand()
      const result = await dispatch('/model', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('Usage: /model <name>')
        expect(result.message).toContain('test-provider/test-model')
      }
    })

    it('switches to the named model within the current provider', async () => {
      const setModel = vi.fn().mockResolvedValue(undefined)
      const refreshSelection = vi.fn()
      const { cmd } = makeCommand({ setModel, refreshSelection })
      const result = await dispatch('/model deepseek-v4', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('Switched to test-provider/deepseek-v4')
      }
      expect(setModel).toHaveBeenCalledWith('test-provider', 'deepseek-v4')
      expect(refreshSelection).toHaveBeenCalledOnce()
    })

    it('switches provider and model with a /-separated argument', async () => {
      const setModel = vi.fn().mockResolvedValue(undefined)
      const { cmd } = makeCommand({ setModel })
      const result = await dispatch('/model other-provider/gpt-4', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('other-provider/gpt-4')
      }
      expect(setModel).toHaveBeenCalledWith('other-provider', 'gpt-4')
    })

    it('reports unavailability when no default-model service is mounted', async () => {
      const ctx = new Context()
      const cmd: CommandContext = {
        ctx,
        agent: { id: 'tui-1' as never, session: makeSession() } as never,
        resetView: vi.fn(),
        setModel: vi.fn().mockResolvedValue(undefined),
        refreshSelection: vi.fn(),
        state: emptyState(),
      }
      const result = await dispatch('/model deepseek-v4', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('No default model service')
      }
    })
  })

  describe('/context', () => {
    it('reports unknown context window before any request', async () => {
      const { cmd } = makeCommand()
      const result = await dispatch('/context', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('test-provider/test-model')
        expect(result.message).toContain('context window: unknown')
        expect(result.message).toContain('input (billed): 0')
        expect(result.message).toContain('output: 0')
        // No percentage line when input is zero
        expect(result.message).not.toContain('%')
      }
    })

    it('shows the context window and does not show a percentage with zero input', async () => {
      const session = makeSession()
      session.append('request/context', {
        provider: 'test-provider',
        model: 'test-model',
        contextWindow: 128_000,
      })
      const { cmd } = makeCommand({
        agent: { id: 'tui-1' as never, session } as never,
      })
      const result = await dispatch('/context', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('128,000')
        // No percentage line when input is zero — the check is inside the
        // `input > 0` guard.
        expect(result.message).not.toContain('usage:')
      }
    })

    it('sums billed input across assistant entries with usage', async () => {
      const session = makeSession()
      const state: UiState = {
        entries: [
          { kind: 'assistant', turn: 1, step: 1, text: 'hi', finalized: true, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 } },
          { kind: 'assistant', turn: 2, step: 1, text: 'bye', finalized: true, usage: { inputTokens: 50, outputTokens: 10, cacheWriteTokens: 200 } },
        ],
        status: 'idle',
        currentTurn: 2,
      }
      const { cmd } = makeCommand({ state, agent: { id: 'tui-1' as never, session } as never })
      const result = await dispatch('/context', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        // input = 100 + 900 + 50 + 200 = 1250
        expect(result.message).toContain('input (billed): 1,250')
        expect(result.message).toContain('output: 30')
      }
    })
  })
})

describe('filterCommands', () => {
  it('returns every command when the buffer is just `/`', () => {
    const result = filterCommands('/').map(c => c.name)
    expect(result).toEqual(['/clear', '/context', '/exit', '/help', '/model', '/quit', '/status'])
  })

  it('filters to commands whose names start with the buffer (case-insensitive)', () => {
    const result = filterCommands('/h').map(c => c.name)
    expect(result).toEqual(['/help'])
  })

  it('distinguishes /clear from /context under a shared prefix', () => {
    // Both start with `/c`, so the palette must offer both rather than
    // silently completing to the first.
    expect(filterCommands('/c').map(c => c.name)).toEqual(['/clear', '/context'])
    expect(filterCommands('/co').map(c => c.name)).toEqual(['/context'])
  })

  it('matches /model under /m prefix', () => {
    expect(filterCommands('/m').map(c => c.name)).toEqual(['/model'])
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

  describe('with plugin registry rows', () => {
    const extra = [
      { name: '/compact', description: 'Compact the conversation' },
      { name: '/goal', description: 'Set the goal' },
    ]

    it('offers registry commands alongside the built-in table', () => {
      expect(filterCommands('/', extra).map(c => c.name)).toEqual([
        '/clear', '/compact', '/context', '/exit', '/goal', '/help', '/model', '/quit', '/status',
      ])
    })

    it('sorts registry rows in with the built-ins rather than after them', () => {
      // `/compact` shares `/c` with two built-ins and must land between them,
      // not in a separate block — the palette is one list to arrow through.
      expect(filterCommands('/c', extra).map(c => c.name)).toEqual(['/clear', '/compact', '/context'])
    })

    it('lets a built-in win a name collision', () => {
      // `dispatch` handles `/clear` before the registry is consulted, so a
      // registry definition of that name can never run. Advertising its
      // description would describe behaviour the user cannot reach.
      const shadowing = [{ name: '/clear', description: 'something else entirely' }]
      const rows = filterCommands('/clear', shadowing)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.description).toMatch(/visible chat/)
    })
  })
})

describe('registryCommands', () => {
  it('returns an empty list when no registry is mounted', () => {
    const { cmd } = makeCommand()
    expect(registryCommands(cmd.ctx, cmd.agent)).toEqual([])
  })

  it('prefixes registry names with a slash and keeps their descriptions', () => {
    const { cmd } = makeCommand()
    cmd.ctx.provide('commands', {
      list: () => [{ name: 'compact', description: 'Compact the conversation' }],
    } as never)
    expect(registryCommands(cmd.ctx, cmd.agent)).toEqual([
      { name: '/compact', description: 'Compact the conversation' },
    ])
  })
})

describe('/help with a registry', () => {
  it('lists plugin commands alongside the built-in ones', () => {
    const { cmd } = makeCommand()
    cmd.ctx.provide('commands', {
      list: () => [{ name: 'compact', description: 'Compact the conversation' }],
    } as never)
    return dispatch('/help', cmd).then((result) => {
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('/compact')
        expect(result.message).toContain('Compact the conversation')
        expect(result.message).toContain('/help')
      }
    })
  })
})
