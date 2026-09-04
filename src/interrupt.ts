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
 *   - A `!` shell command is running → kill it. This outranks the turn
 *     branch: a shell command can only be submitted while the agent is idle,
 *     so the two are never both running, and a child process the user cannot
 *     reach any other way must be reachable by the key that stops things.
 *   - A turn is running → cancel it (model-level cancel, agent continues).
 *   - The prompt holds a half-written line → the prompt clears it and the
 *     App stands down. Leaving the session because someone wanted to abandon
 *     a sentence is not a trade the user can undo.
 *   - The REPL is idle and the line is empty → arm the exit and say so. Only
 *     a second press leaves, through the same `appExit` hook that `/exit`
 *     uses.
 *
 * {@link handleCancel} is the first two branches on their own, which is what
 * `Esc` binds to: stop the work, never close the session.
 *
 * The agent's "running" state is the source of truth for which branch
 * wins.
 * @module @deepseek-ai/dsh-tui/interrupt
 */

import type { Agent } from '@deepseek-ai/dsh-agent'

/** Inputs to {@link handleInterrupt}. Everything is injectable for tests. */
export interface InterruptDeps {
  /** `true` while a `!` shell command is in flight. */
  shellRunning?: boolean
  /** Kill the shell command in flight. */
  abortShell?: () => void
  /** Live agent — used to detect running status and cancel the turn. */
  agent: Agent
  /** Unmount Ink and restore the terminal before the host starts disposal. */
  closeUi: () => void
  /** Exit hook — the same `ctx.appExit` that `/exit` uses. */
  exit: (code: number) => void
  /**
   * `true` while the prompt buffer holds something. Ctrl-C then belongs to
   * the prompt, which clears the line; exiting out from under a half-written
   * message is the one outcome the user cannot undo.
   */
  promptFilled?: boolean
  /**
   * `true` once a bare Ctrl-C has already armed the exit and the user has
   * been told. Only the second press leaves.
   */
  exitArmed?: boolean
  /** Arm the exit and show the notice. Called instead of exiting. */
  armExit?: () => void
}

/**
 * Stop whatever is running, without ever exiting.
 *
 * This is the half of {@link handleInterrupt} that `Esc` gets. Esc means
 * "stop that" everywhere else in this class of tool, and a user who presses
 * it expecting a cancel and gets a closed session has lost the conversation
 * to a keystroke that is supposed to be harmless. So the idle branch here is
 * deliberately nothing at all.
 * @returns whether there was anything to stop.
 */
export function handleCancel(deps: InterruptDeps): boolean {
  if (deps.shellRunning === true) {
    deps.abortShell?.()
    return true
  }
  if (deps.agent.status === 'running') {
    deps.agent.cancel({ kind: 'user' })
    return true
  }
  return false
}

/**
 * Dispatch a Ctrl-C press.
 *
 * The order is by what the press would destroy, most recoverable first: a
 * shell command, then a turn, then the typed line, and only then the
 * session. The last step is two presses rather than one — see `armExit`.
 */
export function handleInterrupt(deps: InterruptDeps): void {
  if (handleCancel(deps)) return
  // The prompt clears its own buffer on this keystroke; the App's job is
  // only to not exit underneath it.
  if (deps.promptFilled === true) return
  if (deps.exitArmed !== true && deps.armExit !== undefined) {
    deps.armExit()
    return
  }
  // This handler runs inside Ink's input EventEmitter. Close Ink first so
  // stdin leaves raw mode and the current input dispatch can finish before
  // the launcher begins disposing the Cordis tree. Requesting host shutdown
  // first deadlocks that disposal path until another input event arrives.
  deps.closeUi()
  deps.exit(0)
}
