/**
 * Interrupt dispatch. The handler is a pure function of the agent's status
 * and an injected exit hook; both branches are pinned here so the
 * "Ctrl-C cancels the turn" and "Ctrl-C exits when idle" guarantees
 * don't drift apart.
 *
 * The Ctrl-C keystroke path itself is exercised in the live TUI (it
 * requires Ink's raw mode, which a vitest run cannot reproduce); what
 * we test here is the dispatch logic the keystroke feeds into.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { handleCancel, handleInterrupt, type InterruptDeps } from '../src/interrupt.ts'

function makeDeps(overrides?: Partial<InterruptDeps['agent']>): {
  deps: InterruptDeps
  cancel: ReturnType<typeof vi.fn>
  closeUi: ReturnType<typeof vi.fn>
  exit: ReturnType<typeof vi.fn>
} {
  const cancel = vi.fn()
  const closeUi = vi.fn()
  const exit = vi.fn()
  const agent = {
    status: 'idle',
    cancel,
    ...overrides,
  } as unknown as Agent
  return { deps: { agent, closeUi, exit }, cancel, closeUi, exit }
}

describe('handleInterrupt', () => {
  it('kills a running `!` command instead of exiting or cancelling', () => {
    const { deps, cancel, closeUi, exit } = makeDeps({ status: 'idle' })
    const abortShell = vi.fn()
    handleInterrupt({ ...deps, shellRunning: true, abortShell })
    expect(abortShell).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
    expect(closeUi).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it('does not exit on a stray shell abort hook when nothing is running', () => {
    // The hook is always wired; only the flag decides the branch. Reading the
    // hook's presence instead would make Ctrl-C stop exiting entirely.
    const { deps, exit } = makeDeps({ status: 'idle' })
    const abortShell = vi.fn()
    handleInterrupt({ ...deps, shellRunning: false, abortShell })
    expect(abortShell).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('cancels the in-flight turn when the agent is running and does not exit', () => {
    const { deps, cancel, closeUi, exit } = makeDeps({ status: 'running' })
    handleInterrupt(deps)
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(closeUi).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it('leaves the REPL through the exit hook when the agent is idle', () => {
    const { deps, cancel, closeUi, exit } = makeDeps({ status: 'idle' })
    handleInterrupt(deps)
    expect(closeUi).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('closes Ink before requesting launcher shutdown', () => {
    const order: string[] = []
    const { deps } = makeDeps({ status: 'idle' })
    deps.closeUi = vi.fn(() => { order.push('ui') })
    deps.exit = vi.fn(() => { order.push('host') })
    handleInterrupt(deps)
    expect(order).toEqual(['ui', 'host'])
  })

  it('uses code 0 to signal a clean exit (not an error code)', () => {
    const { deps, exit } = makeDeps({ status: 'idle' })
    handleInterrupt(deps)
    const code: unknown = exit.mock.calls[0]?.[0]
    expect(code).toBe(0)
  })

  it('treats unknown non-running statuses the same as idle (exits cleanly)', () => {
    // Defensive: if a future agent status like "paused" is added, we still
    // want a stale Ctrl-C to leave the REPL rather than hang.
    const { deps, cancel, closeUi, exit } = makeDeps({ status: 'paused' as never })
    handleInterrupt(deps)
    expect(closeUi).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
    expect(cancel).not.toHaveBeenCalled()
  })
})

/**
 * The two branches that stand between a keystroke and a closed session.
 *
 * Both are about the same failure: Ctrl-C used to exit on the first press
 * with no regard for what was on screen, so abandoning a half-typed line
 * and abandoning the session were the same keystroke.
 */
describe('handleInterrupt · guards before the exit', () => {
  it('stands down when the prompt holds a half-written line', () => {
    // The prompt clears its own buffer on this keystroke. The App's only job
    // is to not exit out from under it.
    const { deps, closeUi, exit } = makeDeps({ status: 'idle' })
    handleInterrupt({ ...deps, promptFilled: true, armExit: vi.fn() })
    expect(closeUi).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it('arms the exit on the first bare press instead of leaving', () => {
    const { deps, closeUi, exit } = makeDeps({ status: 'idle' })
    const armExit = vi.fn()
    handleInterrupt({ ...deps, armExit })
    expect(armExit).toHaveBeenCalledOnce()
    expect(closeUi).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it('leaves on the second press, once armed', () => {
    const { deps, closeUi, exit } = makeDeps({ status: 'idle' })
    const armExit = vi.fn()
    handleInterrupt({ ...deps, exitArmed: true, armExit })
    expect(armExit).not.toHaveBeenCalled()
    expect(closeUi).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits on the first press when no arming hook is wired', () => {
    // `armExit` is optional so a host that wants the old one-press exit — and
    // every existing test above — keeps it. Losing that would turn the guard
    // into a behaviour change nobody opted into.
    const { deps, exit } = makeDeps({ status: 'idle' })
    handleInterrupt(deps)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('cancels a running turn without arming anything', () => {
    // Arming here would mean a Ctrl-C that cancelled a turn also left the
    // next stray Ctrl-C one press away from closing the session.
    const { deps, cancel, exit } = makeDeps({ status: 'running' })
    const armExit = vi.fn()
    handleInterrupt({ ...deps, armExit })
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(armExit).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })
})

/**
 * `Esc`. The whole point of it being a separate entry point is the branch it
 * does *not* have, so that is what most of these assert.
 */
describe('handleCancel', () => {
  it('kills a running `!` command', () => {
    const { deps, cancel } = makeDeps({ status: 'idle' })
    const abortShell = vi.fn()
    expect(handleCancel({ ...deps, shellRunning: true, abortShell })).toBe(true)
    expect(abortShell).toHaveBeenCalledOnce()
    expect(cancel).not.toHaveBeenCalled()
  })

  it('cancels an in-flight turn', () => {
    const { deps, cancel } = makeDeps({ status: 'running' })
    expect(handleCancel(deps)).toBe(true)
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
  })

  it('never exits, even with nothing to stop', () => {
    // The guarantee Esc exists to make. A user pressing it expecting "stop
    // that" must not be able to lose the conversation.
    const { deps, closeUi, exit } = makeDeps({ status: 'idle' })
    expect(handleCancel(deps)).toBe(false)
    expect(closeUi).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it('ignores the prompt buffer entirely', () => {
    // Esc with text in the box is the prompt's business (dismissing a
    // palette); this layer must not read it as a reason to act.
    const { deps, exit } = makeDeps({ status: 'idle' })
    expect(handleCancel({ ...deps, promptFilled: true })).toBe(false)
    expect(exit).not.toHaveBeenCalled()
  })
})
