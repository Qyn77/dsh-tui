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
  exit: ReturnType<typeof vi.fn>
} {
  const cancel = vi.fn()
  const exit = vi.fn()
  const agent = {
    status: 'idle',
    cancel,
    ...overrides,
  } as unknown as Agent
  return { deps: { agent, exit }, cancel, exit }
}

describe('handleInterrupt', () => {
  it('cancels the in-flight turn when the agent is running and does not exit', () => {
    const { deps, cancel, exit } = makeDeps({ status: 'running' })
    handleInterrupt(deps)
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
    expect(exit).not.toHaveBeenCalled()
  })

  it('leaves the REPL through the exit hook when the agent is idle', () => {
    const { deps, cancel, exit } = makeDeps({ status: 'idle' })
    handleInterrupt(deps)
    expect(exit).toHaveBeenCalledWith(0)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('uses code 0 to signal a clean exit (not an error code)', () => {
    const { deps, exit } = makeDeps({ status: 'idle' })
    handleInterrupt(deps)
    const code = exit.mock.calls[0]?.[0]
    expect(code).toBe(0)
  })

  it('treats unknown non-running statuses the same as idle (exits cleanly)', () => {
    // Defensive: if a future agent status like "paused" is added, we still
    // want a stale Ctrl-C to leave the REPL rather than hang.
    const { deps, cancel, exit } = makeDeps({ status: 'paused' as never })
    handleInterrupt(deps)
    expect(exit).toHaveBeenCalledWith(0)
    expect(cancel).not.toHaveBeenCalled()
  })
})
