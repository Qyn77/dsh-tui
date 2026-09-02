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
import { handleInterrupt, type InterruptDeps } from '../src/interrupt.ts'

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
