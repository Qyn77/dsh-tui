/**
 * Answer the approval service's permission questions from the terminal.
 *
 * `dsh-tools` asks `ctx.approval.request()` whenever a tool's permission
 * decision is `ask`, and `ApprovalService` **fails closed**: with no registered
 * answerer it returns `'unavailable'`, which `dsh-tools` maps to a denial. Since
 * dsh-base's `read-only` and `workspace-write` presets both set `approval: ask`,
 * a TUI without this hook does not merely lack a feature — it silently denies
 * every tool call that needed a human answer, with no question ever shown.
 *
 * The service dispatches `approval/request` as a **waterfall**: a listener
 * either claims the request by returning an outcome or declines by calling
 * `next()`. This one claims only questions about its own agent, so a bundle
 * that later runs several agents does not have one terminal answering for
 * another's.
 *
 * Answering is inherently deferred — the outcome is a keystroke that has not
 * happened yet — so the listener returns a promise held open until
 * {@link ApprovalQueue.answer} settles it. Two things can settle it besides the
 * user: `req.signal` aborting (the asker withdrew the question) and the hook
 * unmounting (nobody is left to answer, and a promise held forever would wedge
 * the turn). Both settle rather than leak.
 *
 * `'allowed-once'` is the only grant the vocabulary has. There is deliberately
 * no "always allow" here to build a UI for.
 * @module @deepseek-ai/dsh-tui/hooks/useApprovalRequests
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

/** One question waiting on the user, as the view needs to see it. */
export interface PendingApproval {
  /** Identity for the view's key and for {@link ApprovalQueue.answer}. */
  readonly id: number
  /** The tool the question is about. */
  readonly toolName: string
  /** The asker's explanation of why it is asking, when it gave one. */
  readonly reason?: string
}

/** The queue plus the one operation the view performs on it. */
export interface ApprovalQueue {
  /** Questions waiting on the user, oldest first. */
  readonly pending: readonly PendingApproval[]
  /**
   * Settle the oldest-first question with `id`. A second call for the same id
   * does nothing: the promise is already settled and the entry already gone.
   * @param id - the pending question's id.
   * @param outcome - the user's decision.
   */
  answer: (id: number, outcome: ApprovalOutcome) => void
}

/** A pending question with the machinery the view must not see. */
interface Held extends PendingApproval {
  /** Settle the listener's promise. Idempotent by construction — see `settle`. */
  readonly settle: (outcome: ApprovalOutcome) => void
}

/**
 * Register this terminal as the approval answerer for one agent.
 * @param ctx - the context carrying the `approval/request` waterfall.
 * @param agent - the agent whose questions this terminal answers.
 * @returns the pending questions and the operation that settles one.
 */
export function useApprovalRequests(ctx: Context, agent: Agent): ApprovalQueue {
  const [pending, setPending] = useState<readonly PendingApproval[]>([])
  // The held entries live in a ref, not in state: the listener that creates one
  // and the callback that settles it are both outside the render that produced
  // the list, and a stale closure over state would drop an answer.
  const held = useRef(new Map<number, Held>())
  const nextId = useRef(0)

  const settle = useCallback((id: number, outcome: ApprovalOutcome) => {
    const entry = held.current.get(id)
    if (entry === undefined) return
    held.current.delete(id)
    setPending(list => list.filter(q => q.id !== id))
    entry.settle(outcome)
  }, [])

  useEffect(() => {
    const off = ctx.on('approval/request', async (req, next) => {
      // Not our agent's question. Declining keeps the waterfall's remaining
      // answerers — and the service's fail-closed default — intact.
      if (req.agent !== agent) return await next()
      const id = nextId.current++
      return await new Promise<ApprovalOutcome>((resolve) => {
        let done = false
        const once = (outcome: ApprovalOutcome): void => {
          if (done) return
          done = true
          resolve(outcome)
        }
        const entry: Held = {
          id,
          toolName: req.toolName,
          ...req.reason !== undefined ? { reason: req.reason } : {},
          settle: once,
        }
        held.current.set(id, entry)
        setPending(list => [...list, { id, toolName: entry.toolName, ...entry.reason !== undefined ? { reason: entry.reason } : {} }])
        // The asker withdrawing is not a user decision, so it does not go
        // through `settle`'s answer path — but the card must still disappear.
        req.signal?.addEventListener('abort', () => { settle(id, 'cancelled') }, { once: true })
      })
    })
    return () => {
      off()
      // Nothing is left to answer. Reporting `'unavailable'` is exactly what the
      // service would have produced with no answerer registered, so a turn in
      // flight during teardown ends the way it would have without this hook
      // instead of hanging on a promise that can never settle.
      for (const id of [...held.current.keys()]) settle(id, 'unavailable')
    }
  }, [ctx, agent, settle])

  const answer = useCallback((id: number, outcome: ApprovalOutcome) => {
    settle(id, outcome)
  }, [settle])

  return { pending, answer }
}
