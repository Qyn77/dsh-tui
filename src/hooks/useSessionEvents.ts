/**
 * Live subscription to the agent's session events, fed through the reducer.
 * Seeds from the durable log on first render, then keeps the projected view
 * in sync with each `session/event` arrival.
 * @module @deepseek-ai/dsh-tui/hooks/useSessionEvents
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isRenderable, type UiEntry, type UiState } from '../types.ts'
import { initialState, reduce } from '../state.ts'

/**
 * What can change the projected view.
 *
 * `event` is the only action the pure reducer sees. The other three are local
 * view operations with no session event behind them: `reset` backs `/clear`,
 * `append` backs output that the TUI itself produced (slash command results),
 * which must not be written into the durable session log because the model
 * never saw it, and `seed` replaces the whole projection when the agent under
 * the App changes identity.
 */
type ViewAction =
  | { type: 'event'; event: import('@deepseek-ai/dsh-session').SessionEvent }
  | { type: 'reset' }
  | { type: 'append'; entry: UiEntry }
  | { type: 'seed'; events: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }

/** Fold a durable log into a fresh projection. */
function seedFrom(events: readonly import('@deepseek-ai/dsh-session').SessionEvent[]): UiState {
  let acc = initialState()
  for (const event of events) {
    if (isRenderable(event)) acc = reduce(acc, event)
  }
  return acc
}

/**
 * Reactive UI state derived from a live Agent. The returned value re-renders
 * the consumer whenever a relevant session event arrives.
 * @param ctx - the root Cordis context (used to subscribe to `session/event`).
 * @param agent - the agent whose session drives the projection.
 * @returns the current projected UI state, a resetter, and a local appender.
 */
export function useSessionEvents(ctx: Context, agent: Agent): {
  state: UiState
  resetView: () => void
  appendEntry: (entry: UiEntry) => void
} {
  const [state, dispatch] = useReducer(
    (acc: UiState, action: ViewAction) => {
      if (action.type === 'reset') return { ...acc, entries: [] }
      if (action.type === 'append') return { ...acc, entries: [...acc.entries, action.entry] }
      if (action.type === 'seed') return seedFrom(action.events)
      return reduce(acc, action.event)
    },
    undefined,
    // Replay the durable log once to seed the view. The agent's session owns
    // the canonical event list, so resuming an existing session immediately
    // shows prior work.
    () => seedFrom(agent.session.events),
  )

  // Keep a ref to the agent so the subscription effect closes over the latest
  // identity without forcing a re-subscribe.
  const agentRef = useRef(agent)
  agentRef.current = agent

  // Re-seed when the agent under the App changes identity, which `/resume`
  // does mid-session. This is done during render rather than in an effect on
  // purpose: an effect runs *after* the frame is drawn, so the terminal would
  // visibly flash one frame of the previous session's transcript before the
  // resumed one replaced it.
  const seededId = useRef(agent.session.id)
  if (seededId.current !== agent.session.id) {
    seededId.current = agent.session.id
    dispatch({ type: 'seed', events: agent.session.events })
  }

  useEffect(() => {
    const handler = (session: import('@deepseek-ai/dsh-session').Session, event: import('@deepseek-ai/dsh-session').SessionEvent): void => {
      if (session.id !== agentRef.current.session.id) return
      if (!isRenderable(event)) return
      dispatch({ type: 'event', event })
    }
    const off = ctx.on('session/event', handler)
    return () => { off() }
  }, [ctx, agent.session.id])

  const resetView = useCallback((): void => {
    dispatch({ type: 'reset' })
  }, [])

  const appendEntry = useCallback((entry: UiEntry): void => {
    dispatch({ type: 'append', entry })
  }, [])

  return { state, resetView, appendEntry }
}
