/**
 * Interrupt dispatch for the TUI. Pulled out so the dispatch is
 * unit-testable without booting a real Cordis tree or a real TTY.
 *
 * In Ink's raw mode, Ctrl-C is delivered as a keystroke (input `'c'`
 * with `key.ctrl === true`), not as a SIGINT signal — so the
 * `process.on('SIGINT', ...)` path is dead. The {@link handleInterrupt}
 * dispatch is what the App's `useInput` hook calls when it sees that
 * keystroke. The function's semantics match the contract in
 * [docs/SPEC.md](../docs/SPEC.md) Part 1.6 and the README's slash-
 * command table:
 *
 *   - A turn is running → cancel it (model-level cancel, agent continues).
 *   - The REPL is idle → leave through the same `appExit` hook that
 *     `/exit` uses.
 *
 * The agent's "running" state is the source of truth for which branch
 * wins.
 * @module @deepseek-ai/dsh-tui/interrupt
 */

import type { Agent } from '@deepseek-ai/dsh-agent'

/** Inputs to {@link handleInterrupt}. Everything is injectable for tests. */
export interface InterruptDeps {
  /** Live agent — used to detect running status and cancel the turn. */
  agent: Agent
  /** Unmount Ink and restore the terminal before the host starts disposal. */
  closeUi: () => void
  /** Exit hook — the same `ctx.appExit` that `/exit` uses. */
  exit: (code: number) => void
}

/**
 * Dispatch a Ctrl-C press. Idempotent on `cancel()` / `exit(0)`
 * semantics: a second press while still idle would re-enter `exit(0)`,
 * which is a no-op for the launcher hook and a no-op for `process.exit`
 * (the process is already on its way out).
 */
export function handleInterrupt(deps: InterruptDeps): void {
  if (deps.agent.status === 'running') {
    deps.agent.cancel({ kind: 'user' })
    return
  }
  // This handler runs inside Ink's input EventEmitter. Close Ink first so
  // stdin leaves raw mode and the current input dispatch can finish before
  // the launcher begins disposing the Cordis tree. Requesting host shutdown
  // first deadlocks that disposal path until another input event arrives.
  deps.closeUi()
  deps.exit(0)
}
