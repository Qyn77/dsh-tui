/**
 * Live subscription to the agent's session events, fed through the reducer.
 * Seeds from the durable log on first render, then keeps the projected view
 * in sync with each `session/event` arrival.
 * @module @deepseek-ai/dsh-tui/hooks/useSessionEvents
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isRenderable, type HistoryPref, type UiEntry, type UiState } from '../types.ts'
import { initialState, reduce } from '../state.ts'

/**
 * What can change the projected view.
 *
 * `event` is the only action the pure reducer sees. `reset` backs `/clear`,
 * `append` backs output that the TUI itself produced (slash command results),
 * which must not be written into the durable session log because the model
 * never saw it, and `seed` replaces the whole projection — at boot, when
 * `/resume` swaps the agent under the App, and when `/history` changes how
 * much of the log a seed is allowed to draw.
 */
type ViewAction =
  | { type: 'event'; event: import('@deepseek-ai/dsh-session').SessionEvent }
  | { type: 'reset' }
  | { type: 'append'; entry: UiEntry }
  | { type: 'seed'; state: UiState }

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
 * @param options - `history` decides how much of a seeded log is drawn:
 * `'show'` (the default) replays it whole, `'hide'` starts the transcript at
 * the events this process appended — the ones past the seed boundary, which
 * is where the live work of a resumed session begins.
 * @returns the current projected UI state, a resetter, and a local appender.
 */
export function useSessionEvents(ctx: Context, agent: Agent, options?: { history?: HistoryPref }): {
  state: UiState
  resetView: () => void
  appendEntry: (entry: UiEntry) => void
} {
  const history = options?.history ?? 'show'
  const [state, dispatch] = useReducer(
    (acc: UiState, action: ViewAction) => {
      if (action.type === 'reset') return { ...acc, entries: [] }
      if (action.type === 'append') return { ...acc, entries: [...acc.entries, action.entry] }
      if (action.type === 'seed') return action.state
      return reduce(acc, action.event)
    },
    undefined,
    // Replay the durable log once to seed the view. The agent's session owns
    // the canonical event list, so resuming an existing session immediately
    // shows prior work — unless the user asked to start at the live work, in
    // which case nothing constructed before this process is drawn and the
    // boundary below (the full log length, at boot) is where the view begins.
    () => (history === 'hide' ? initialState() : seedFrom(agent.session.events)),
  )

  // Keep a ref to the agent so the subscription effect closes over the latest
  // identity without forcing a re-subscribe.
  const agentRef = useRef(agent)
  agentRef.current = agent

  // Entries the TUI appended locally — slash command output, notes — which no
  // session event stands behind. A re-seed rebuilds the event-backed rows from
  // the log and re-appends these, so toggling `/history` does not swallow the
  // line that said "/resume switched". Cleared when the view is reset or the
  // agent is swapped: a new session's screen starts with its own rows only.
  const localRef = useRef<UiEntry[]>([])

  // Where this process's live work begins: the log length at the moment the
  // agent came under the App. Everything before it arrived through
  // construction (boot resume or `/resume`), so it is exactly the stretch a
  // `hide` must drop — and the stretch a later `/history show` may replay,
  // while the events appended since are kept either way.
  const boundaryRef = useRef(agent.session.events.length)

  // Re-seed when the agent under the App changes identity, which `/resume`
  // does mid-session, and when the history preference moves, which `/history`
  // does. This is done during render rather than in an effect on purpose: an
  // effect runs *after* the frame is drawn, so the terminal would visibly
  // flash one frame of the previous session's transcript before the resumed
  // one replaced it.
  const seededId = useRef(agent.session.id)
  const seededHistory = useRef<HistoryPref>(history)
  if (seededId.current !== agent.session.id || seededHistory.current !== history) {
    const swapped = seededId.current !== agent.session.id
    seededId.current = agent.session.id
    seededHistory.current = history
    if (swapped) {
      boundaryRef.current = agent.session.events.length
      localRef.current = []
    }
    const events = agent.session.events
    const visible = history === 'hide' ? events.slice(boundaryRef.current) : events
    const seeded = seedFrom(visible)
    dispatch({
      type: 'seed',
      state: { ...seeded, entries: [...seeded.entries, ...localRef.current] },
    })
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
    localRef.current = []
    dispatch({ type: 'reset' })
  }, [])

  const appendEntry = useCallback((entry: UiEntry): void => {
    localRef.current = [...localRef.current, entry]
    dispatch({ type: 'append', entry })
  }, [])

  return { state, resetView, appendEntry }
}
