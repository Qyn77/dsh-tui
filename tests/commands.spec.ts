/**
 * Slash command dispatch. The commands run asynchronously against a real Cordis
 * context (minimal: only the services each command consults) and a real
 * Agent-shaped stand-in, then assert the `CommandResult` and the recorded
 * process effects.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { dispatch, filterCommands, registryCommands, type CommandContext } from '../src/commands.ts'
import { catalog } from '../src/i18n.ts'
import type { UiState } from '../src/types.ts'
import { OSC52_MAX_BYTES, osc52 } from '../src/clipboard.ts'

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

  it('tells the reader about the `!` escape, which is not a command', async () => {
    // `!` cannot be in the registry, and a user looking for "how do I run a
    // shell command" looks in `/help` and nowhere else.
    const { cmd } = makeCommand()
    const result = await dispatch('/help', cmd)
    expect(result.kind).toBe('handled')
    if (result.kind !== 'handled') return
    expect(result.message).toContain(catalog('en').shell.usage)
  })

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

  describe('/plugins', () => {
    const updates: { id: string; options: unknown }[] = []

    /**
     * A loader stand-in: `entries()` is a generator method, as cordis's is, and
     * `update()` records instead of writing. The real one rewrites the user's
     * config file, so the assertions here are about *whether* it is called at
     * all as much as about the message.
     */
    function withLoader(entries: readonly unknown[], fail?: Error): CommandContext {
      const ctx = new Context()
      ctx.provide('loader', {
        * entries() { yield* entries },
        update: (id: string, options: unknown) => {
          if (fail) return Promise.reject(fail)
          updates.push({ id, options })
          return Promise.resolve()
        },
      } as never)
      return {
        ctx,
        agent: { id: 'tui-1' as never, session: makeSession() } as never,
        resetView: vi.fn(),
        setModel: vi.fn().mockResolvedValue(undefined),
        refreshSelection: vi.fn(),
        state: emptyState(),
      }
    }

    it('lists what the loader has, broken first', async () => {
      const cmd = withLoader([
        { id: 'a', disabled: false, options: { name: 'pkg-ok' }, fiber: { state: 2 } },
        { id: 'b', disabled: false, options: { name: 'pkg-bad' }, fiber: { state: 3 } },
      ])
      const result = await dispatch('/plugins', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind !== 'handled') return
      const lines = result.message?.split('\n') ?? []
      expect(lines[0]).toBe('plugins (2):')
      expect(lines[1]).toContain('pkg-bad')
      expect(lines[1]).toContain('failed')
      expect(lines[2]).toContain('pkg-ok')
    })

    it('reads the loader again on every call, so a state change shows', async () => {
      // The loader is the authority; nothing here caches its answer. A plugin
      // that fails after startup has to be visible without a restart.
      const entries = [{ id: 'a', disabled: false, options: { name: 'pkg' }, fiber: { state: 2 } }]
      const cmd = withLoader(entries)
      const before = await dispatch('/plugins', cmd)
      entries[0].fiber.state = 3
      const after = await dispatch('/plugins', cmd)
      if (before.kind !== 'handled' || after.kind !== 'handled') throw new Error('unreachable')
      expect(before.message).toContain('active')
      expect(after.message).toContain('failed')
    })

    it('says so when the loader has nothing rather than printing a bare heading', async () => {
      const result = await dispatch('/plugins', withLoader([]))
      if (result.kind !== 'handled') throw new Error('unreachable')
      expect(result.message).toBe(catalog('en').output.noPlugins)
    })

    it('degrades when no loader is mounted, as an embedded assembly has none', async () => {
      const cmd: CommandContext = {
        ctx: new Context(),
        agent: { id: 'tui-1' as never, session: makeSession() } as never,
        resetView: vi.fn(),
        setModel: vi.fn().mockResolvedValue(undefined),
        refreshSelection: vi.fn(),
        state: emptyState(),
      }
      const result = await dispatch('/plugins', cmd)
      if (result.kind !== 'handled') throw new Error('unreachable')
      expect(result.message).toBe(catalog('en').output.noLoader)
    })

    it('reports in the caller language', async () => {
      const cmd = withLoader([
        { id: 'a', disabled: false, options: { name: 'pkg' }, fiber: { state: 2 } },
      ])
      const result = await dispatch('/plugins', { ...cmd, lang: 'zh' })
      if (result.kind !== 'handled') throw new Error('unreachable')
      expect(result.message).toContain('插件（1）：')
      expect(result.message).toContain('运行中')
    })

    describe('enable and disable', () => {
      const off = { id: 'off', disabled: true, options: { name: 'pkg-off', disabled: true } }
      const on = { id: 'on', disabled: false, options: { name: 'pkg-on' }, fiber: { state: 2 } }

      beforeEach(() => { updates.length = 0 })

      it('disables a running plugin by deleting nothing and setting the flag', async () => {
        const result = await dispatch('/plugins disable pkg-on', withLoader([on]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(updates).toEqual([{ id: 'on', options: { disabled: true } }])
        expect(result.message).toContain('pkg-on')
        expect(result.failed).toBeUndefined()
      })

      it('re-enables by deleting the flag rather than writing false', async () => {
        // Writing `disabled: false` would leave a key in the user's config that
        // was not there before they typed the command.
        await dispatch('/plugins enable pkg-off', withLoader([off]))
        expect(updates).toEqual([{ id: 'off', options: { disabled: null } }])
      })

      it('writes nothing when the plugin is already in that state', async () => {
        const result = await dispatch('/plugins enable pkg-on', withLoader([on]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(updates).toEqual([])
        expect(result.message).toBe(catalog('en').output.pluginUnchanged('pkg-on', true))
      })

      it('refuses to switch off the interface running the command', async () => {
        const self = {
          id: 'tui', disabled: false, options: { name: '@deepseek-ai/dsh-tui' }, fiber: { state: 2 },
        }
        const result = await dispatch('/plugins disable dsh-tui', withLoader([self]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(updates).toEqual([])
        expect(result.failed).toBe(true)
      })

      it('refuses to overwrite a switch that is an expression', async () => {
        const expr = {
          id: 'x', disabled: false, options: { name: 'pkg-x', disabled: { __jsExpr: 'env.CI' } },
          fiber: { state: 2 },
        }
        const result = await dispatch('/plugins disable pkg-x', withLoader([expr]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(updates).toEqual([])
        expect(result.message).toBe(catalog('en').output.pluginLockedExpression('pkg-x'))
      })

      it('sends the user to the group when the group is what is off', async () => {
        const inherited = { id: 'g', disabled: true, options: { name: 'pkg-g' } }
        const result = await dispatch('/plugins enable pkg-g', withLoader([inherited]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(updates).toEqual([])
        expect(result.message).toBe(catalog('en').output.pluginLockedInherited('pkg-g'))
      })

      it('reports an ambiguous target instead of picking one', async () => {
        const twin = { id: 'on2', disabled: false, options: { name: 'pkg-on-extra' }, fiber: { state: 2 } }
        // `pkg-o` is a prefix of both, and neither name matches it exactly.
        const result = await dispatch('/plugins disable pkg-o', withLoader([on, twin]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(updates).toEqual([])
        expect(result.failed).toBe(true)
        expect(result.message).toContain('pkg-on-extra')
      })

      it('reports a target that names nothing', async () => {
        const result = await dispatch('/plugins disable nope', withLoader([on]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(result.failed).toBe(true)
        expect(result.message).toBe(catalog('en').output.pluginNotFound('nope'))
      })

      it('repeats the loader’s own reason when the switch throws', async () => {
        // `update` both restarts the plugin and writes the file, so a throw can
        // mean either half failed — inventing a reason would hide which.
        const result = await dispatch(
          '/plugins enable pkg-off',
          withLoader([off], new Error('module not found')),
        )
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(result.failed).toBe(true)
        expect(result.message).toContain('module not found')
      })

      it('prints usage for a verb it does not know', async () => {
        const result = await dispatch('/plugins toggle pkg-on', withLoader([on]))
        if (result.kind !== 'handled') throw new Error('unreachable')
        expect(result.message).toBe(catalog('en').output.pluginUsage)
      })
    })
  })

  describe('/language', () => {
    it('shows usage and the current language when no argument is given', async () => {
      const setLanguage = vi.fn()
      const { cmd } = makeCommand({ setLanguage })
      const result = await dispatch('/language', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('Usage: /language')
        expect(result.message).toContain('Current: en')
      }
      // Reporting is not switching.
      expect(setLanguage).not.toHaveBeenCalled()
    })

    it('switches the interface language and confirms in the new one', async () => {
      const setLanguage = vi.fn()
      const { cmd } = makeCommand({ setLanguage })
      const result = await dispatch('/language zh', cmd)
      expect(setLanguage).toHaveBeenCalledWith('zh')
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        // Written in Chinese on purpose: the confirmation is the first thing
        // the user reads in the language they just asked for, so a mistyped
        // code is visible immediately rather than being reported in a
        // language they cannot check.
        expect(result.message).toBe(catalog('zh').output.languageSwitched)
        expect(result.failed).not.toBe(true)
      }
    })

    it('accepts the aliases a bilingual user is likely to type', async () => {
      for (const arg of ['ZH', 'cn', '中文', 'zh-CN']) {
        const setLanguage = vi.fn()
        const { cmd } = makeCommand({ setLanguage })
        await dispatch(`/language ${arg}`, cmd)
        expect(setLanguage).toHaveBeenCalledWith('zh')
      }
    })

    it('reports an unknown language as a failure and changes nothing', async () => {
      const setLanguage = vi.fn()
      const { cmd } = makeCommand({ setLanguage })
      const result = await dispatch('/language fr', cmd)
      expect(setLanguage).not.toHaveBeenCalled()
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.failed).toBe(true)
        expect(result.message).toContain('fr')
      }
    })

    it('writes its own output in the language in force when it was typed', async () => {
      // A user already in Chinese asking for the usage line gets it in Chinese.
      const { cmd } = makeCommand({ lang: 'zh' })
      const result = await dispatch('/language', cmd)
      if (result.kind === 'handled') {
        expect(result.message).toBe(catalog('zh').output.languageUsage('zh'))
      }
    })

    it('still reports the switch when no handler was wired', async () => {
      // `setLanguage` is optional, so a context built without one — the shape
      // most tests use — must not throw on a `/language` line.
      const { cmd } = makeCommand()
      const result = await dispatch('/language zh', cmd)
      expect(result.kind).toBe('handled')
    })
  })

  describe('/theme', () => {
    it('shows usage, the setting, and what the setting resolved to', async () => {
      const setTheme = vi.fn()
      const { cmd } = makeCommand({ setTheme, themePref: 'auto', appearance: 'light' })
      const result = await dispatch('/theme', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('Usage: /theme')
        // Both halves: "auto" alone does not tell the user which way it went,
        // and which way it went is the only reason to run the command.
        expect(result.message).toContain('Current: auto')
        expect(result.message).toContain('light')
      }
      expect(setTheme).not.toHaveBeenCalled()
    })

    it('does not report a detected appearance when the setting is explicit', async () => {
      const { cmd } = makeCommand({ themePref: 'dark', appearance: 'dark' })
      const result = await dispatch('/theme', cmd)
      if (result.kind === 'handled') {
        expect(result.message).toContain('Current: dark')
        expect(result.message).not.toContain('detected')
      }
    })

    it('switches to an explicit appearance', async () => {
      const setTheme = vi.fn()
      const { cmd } = makeCommand({ setTheme })
      const result = await dispatch('/theme light', cmd)
      expect(setTheme).toHaveBeenCalledWith('light')
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') expect(result.failed).not.toBe(true)
    })

    it('switches back to auto and says what auto found', async () => {
      const setTheme = vi.fn()
      const { cmd } = makeCommand({ setTheme, themePref: 'light', appearance: 'dark' })
      const result = await dispatch('/theme auto', cmd)
      expect(setTheme).toHaveBeenCalledWith('auto')
      if (result.kind === 'handled') {
        // The measurement, not the word "auto": the user is switching *to* a
        // guess and the useful part of the answer is what the guess was.
        expect(result.message).toContain('dark')
      }
    })

    it('rejects anything else without switching', async () => {
      const setTheme = vi.fn()
      const { cmd } = makeCommand({ setTheme })
      const result = await dispatch('/theme solarized', cmd)
      expect(setTheme).not.toHaveBeenCalled()
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.failed).toBe(true)
        expect(result.message).toContain('solarized')
      }
    })

    it('reports without a handler rather than throwing', async () => {
      // `setTheme` is optional so most tests can omit it; a `/theme` line that
      // lands in one of those contexts must still answer.
      const { cmd } = makeCommand({})
      const result = await dispatch('/theme dark', cmd)
      expect(result.kind).toBe('handled')
    })
  })


  describe('/copy', () => {
    /** A state whose newest assistant entry is `text`. */
    function withReply(text: string): UiState {
      return {
        entries: [{ kind: 'assistant', turn: 1, step: 1, text, finalized: true }],
        status: 'idle',
        currentTurn: 1,
      }
    }

    it('emits the newest reply and reports what it sent', async () => {
      const emit = vi.fn()
      const { cmd } = makeCommand({ emit, state: withReply('the answer') })
      const result = await dispatch('/copy', cmd)
      expect(emit).toHaveBeenCalledWith(osc52('the answer'))
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.failed).not.toBe(true)
        // The unit is bytes, and it is the byte count of what was actually sent.
        expect(result.message).toContain('10 bytes')
      }
    })

    it('emits the newest code block for `code`', async () => {
      const emit = vi.fn()
      const { cmd } = makeCommand({ emit, state: withReply('try:\n\n```sh\nls -la\n```') })
      await dispatch('/copy code', cmd)
      expect(emit).toHaveBeenCalledWith(osc52('ls -la'))
    })

    it('refuses an empty conversation without emitting', async () => {
      const emit = vi.fn()
      const { cmd } = makeCommand({ emit })
      const result = await dispatch('/copy', cmd)
      expect(emit).not.toHaveBeenCalled()
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') expect(result.failed).toBe(true)
    })

    it('refuses `code` when the conversation holds no fence', async () => {
      const emit = vi.fn()
      const { cmd } = makeCommand({ emit, state: withReply('no code here') })
      const result = await dispatch('/copy code', cmd)
      expect(emit).not.toHaveBeenCalled()
      if (result.kind === 'handled') expect(result.failed).toBe(true)
    })

    it('prints usage for an unrecognised argument rather than guessing', async () => {
      // Copying the whole reply for `/copy codee` would be discovered on paste,
      // which is the worst place to discover it.
      const emit = vi.fn()
      const { cmd } = makeCommand({ emit, state: withReply('```ts\nx\n```') })
      const result = await dispatch('/copy codee', cmd)
      expect(emit).not.toHaveBeenCalled()
      if (result.kind === 'handled') {
        expect(result.failed).toBe(true)
        expect(result.message).toContain('/copy code')
      }
    })

    it('prints usage for a second argument', async () => {
      const emit = vi.fn()
      const { cmd } = makeCommand({ emit, state: withReply('```ts\nx\n```') })
      const result = await dispatch('/copy code please', cmd)
      expect(emit).not.toHaveBeenCalled()
      if (result.kind === 'handled') expect(result.failed).toBe(true)
    })

    it('clamps an oversized reply and says so', async () => {
      const emit = vi.fn()
      const { cmd } = makeCommand({ emit, state: withReply('x'.repeat(OSC52_MAX_BYTES + 100)) })
      const result = await dispatch('/copy', cmd)
      expect(emit).toHaveBeenCalledWith(osc52('x'.repeat(OSC52_MAX_BYTES)))
      if (result.kind === 'handled') {
        // Reported, not silent: a half-copied file is indistinguishable from a
        // whole one until the user pastes it.
        expect(result.message).toContain('truncated')
      }
    })

    it('reports without a handler rather than throwing', async () => {
      // `emit` is optional, like `setTheme`. A `/copy` in a context without one
      // still answers instead of crashing the turn.
      const { cmd } = makeCommand({ state: withReply('the answer') })
      const result = await dispatch('/copy', cmd)
      expect(result.kind).toBe('handled')
    })
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

  describe('/usage', () => {
    it('says so before any turn has reported tokens', async () => {
      const { cmd } = makeCommand()
      const result = await dispatch('/usage', cmd)
      if (result.kind !== 'handled') throw new Error('unreachable')
      expect(result.message).toBe(catalog('en').output.noUsage)
    })

    it('prints one row per turn and a total', async () => {
      const state: UiState = {
        entries: [
          {
            kind: 'assistant', turn: 1, step: 0, text: 'a', finalized: true,
            usage: { inputTokens: 100, outputTokens: 10 } as never,
          },
          {
            kind: 'assistant', turn: 2, step: 0, text: 'b', finalized: true,
            usage: { inputTokens: 200, outputTokens: 20 } as never,
          },
        ],
        status: 'idle',
        currentTurn: 2,
      }
      const { cmd } = makeCommand({ state })
      const result = await dispatch('/usage', cmd)
      if (result.kind !== 'handled') throw new Error('unreachable')
      const lines = result.message?.split('\n') ?? []
      expect(lines[0]).toBe('token spend, 2 turns:')
      expect(lines).toHaveLength(5)
      expect(lines.at(-1)).toContain('300')
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
        expect(result.message).toContain('billed input (session): 0')
        expect(result.message).toContain('output (session): 0')
        // No occupancy line at all before a turn has reported usage — a `0%`
        // here would be a claim about a window nothing has measured.
        expect(result.message).not.toContain('in context now')
        expect(result.message).not.toContain('%')
      }
    })

    it('shows the context window but no occupancy until a turn reports usage', async () => {
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
        expect(result.message).not.toContain('in context now')
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
        expect(result.message).toContain('billed input (session): 1,250')
        expect(result.message).toContain('output (session): 30')
      }
    })

    it('takes the percentage from the newest turn, not from the running total', async () => {
      // The reported bug. Cumulative billed input here is 132,000 — more than
      // the whole window — while the conversation in front of the model is
      // 12,600 tokens. The old report said `usage: 103%`.
      const session = makeSession()
      session.append('request/context', {
        provider: 'test-provider',
        model: 'test-model',
        contextWindow: 128_000,
      })
      const state: UiState = {
        entries: [
          { kind: 'assistant', turn: 1, step: 1, text: 'a', finalized: true, usage: { inputTokens: 60_000, outputTokens: 200 } },
          { kind: 'assistant', turn: 2, step: 1, text: 'b', finalized: true, usage: { inputTokens: 60_000, outputTokens: 200 } },
          { kind: 'assistant', turn: 3, step: 1, text: 'c', finalized: true, usage: { inputTokens: 12_000, outputTokens: 600 } },
        ],
        status: 'idle',
        currentTurn: 3,
      }
      const { cmd } = makeCommand({ state, agent: { id: 'tui-1' as never, session } as never })
      const result = await dispatch('/context', cmd)
      expect(result.kind).toBe('handled')
      if (result.kind === 'handled') {
        expect(result.message).toContain('billed input (session): 132,000')
        // 12,600 / 128,000 = 9.84% → 10%.
        expect(result.message).toContain('in context now: 12,600 (10%)')
        expect(result.message).not.toContain('103%')
      }
    })
  })
})

describe('filterCommands', () => {
  it('returns every command when the buffer is just `/`', () => {
    const result = filterCommands('/').map(c => c.name)
    expect(result).toEqual([
      '/clear', '/context', '/copy', '/exit', '/help', '/language', '/model', '/plugins',
      '/quit', '/status', '/theme', '/usage',
    ])
  })

  it('filters to commands whose names start with the buffer (case-insensitive)', () => {
    const result = filterCommands('/h').map(c => c.name)
    expect(result).toEqual(['/help'])
  })

  it('distinguishes /clear from /context under a shared prefix', () => {
    // Both start with `/c`, so the palette must offer both rather than
    // silently completing to the first.
    expect(filterCommands('/c').map(c => c.name)).toEqual(['/clear', '/context', '/copy'])
    expect(filterCommands('/co').map(c => c.name)).toEqual(['/context', '/copy'])
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
        '/clear', '/compact', '/context', '/copy', '/exit', '/goal', '/help', '/language', '/model',
        '/plugins', '/quit', '/status', '/theme', '/usage',
      ])
    })

    it('sorts registry rows in with the built-ins rather than after them', () => {
      // `/compact` shares `/c` with two built-ins and must land between them,
      // not in a separate block — the palette is one list to arrow through.
      expect(filterCommands('/c', extra).map(c => c.name))
        .toEqual(['/clear', '/compact', '/context', '/copy'])
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
