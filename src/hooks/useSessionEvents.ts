/** Project persisted session events and the active Agent's transient response. */
import { useCallback, useLayoutEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { initialState, reduce } from '../core/state.ts'
import { service } from '../core/services.ts'
import { catalog } from '../core/i18n.ts'
import { isRenderable, type HistoryPref, type UiEntry, type UiState } from '../core/types.ts'

type Change =
  | { type: 'event'; event: SessionEvent }
  | { type: 'clear' }
  | { type: 'local'; entry: UiEntry }

function apply(state: UiState, change: Change): UiState {
  if (change.type === 'event') return reduce(state, change.event)
  if (change.type === 'clear') return { ...state, entries: [], tasks: [] }
  return { ...state, entries: [...state.entries, change.entry] }
}

interface Attempt {
  start: Extract<AssistantStreamFrame, { type: 'start' }>
  text: string
}

interface View {
  session: Session
  full: UiState
  live: UiState
  pending?: Change[]
  attempt?: Attempt
  revision: number
}

function empty(session: Session): View {
  const live = initialState()
  return { session, live, full: live, pending: [], revision: 0 }
}

function changeView(view: View, change: Change): View {
  const live = apply(view.live, change)
  const full = view.full === view.live ? live : apply(view.full, change)
  return { ...view, live, full, pending: view.pending?.concat(change) }
}

function stream(view: View, frame: AssistantStreamFrame): View {
  if (frame.revision <= view.revision) return view
  if (frame.type === 'start') {
    return { ...view, revision: frame.revision, attempt: { start: frame, text: '' } }
  }
  const attempt = view.attempt
  if (!attempt || attempt.start.attemptId !== frame.attemptId) return view
  if (frame.type === 'end') return { ...view, revision: frame.revision, attempt: undefined }
  const chunk = frame.chunk
  if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return view
  return { ...view, revision: frame.revision, attempt: { ...attempt, text: attempt.text + chunk.text } }
}

export function useSessionEvents(ctx: Context, agent: Agent, options?: { history?: HistoryPref; historyError?: string }): {
  state: UiState
  resetView: () => void
  appendEntry: (entry: UiEntry) => void
} {
  const session = agent.session
  const [view, setView] = useState(() => empty(session))
  if (view.session !== session) setView(empty(session))
  const historyError = options?.historyError ?? catalog('en').output.historyReadFailed

  useLayoutEffect(() => {
    const cut = session.seq
    let active = true
    const offEvent = ctx.on('session/event', (owner, event) => {
      if (owner !== session || event.seq < cut || !isRenderable(event)) return
      setView((prev) => {
        if (prev.session !== session) return prev
        const next = changeView(prev, { type: 'event', event })
        const start = next.attempt?.start
        if (start && ((event.type === 'turn/end' && event.data.turn === start.turn)
          || ((event.type === 'assistant/message' || event.type === 'assistant/attempt')
            && event.data.turn === start.turn && event.data.step === start.step))) {
          return { ...next, attempt: undefined }
        }
        return next
      })
    })
    const offStream = ctx.on('agent/assistant-stream', ({ agent: owner, frame }) => {
      if (owner.session === session) setView(prev => prev.session === session ? stream(prev, frame) : prev)
    })

    // Subscribe before reading the prefix. Only events below cut come from
    // storage. Commands, clears and live events received during I/O retain order.
    async function seed(): Promise<void> {
      let full = initialState()
      try {
        const persistence = service(ctx, 'sessionPersistence')
        if (cut > 0 && persistence) {
          await service(ctx, 'sessions')?.flush(session)
          const reader = await persistence.open(session.id, 'read')
          try {
            const { events } = await reader.read(0, cut)
            for (const event of events) if (isRenderable(event)) full = reduce(full, event)
          } finally {
            await reader.close()
          }
        }
      } catch {
        full = apply(full, { type: 'local', entry: { kind: 'note', tone: 'warn', text: historyError } })
      }
      if (active) setView(prev => prev.session === session
        ? { ...prev, full: (prev.pending ?? []).reduce(apply, full), pending: undefined }
        : prev)
    }
    void seed()
    return () => { active = false; offEvent(); offStream() }
    // The notice uses the language in force when this session was opened.
  }, [ctx, session])

  const resetView = useCallback(() => { setView(prev => changeView(prev, { type: 'clear' })) }, [])
  const appendEntry = useCallback((entry: UiEntry) => { setView(prev => changeView(prev, { type: 'local', entry })) }, [])
  let state = options?.history === 'hide' ? view.live : view.full
  if (view.attempt) {
    const { start, text } = view.attempt
    state = { ...state, entries: [...state.entries, { kind: 'assistant', turn: start.turn, step: start.step, text, finalized: false }] }
  }
  return { state, resetView, appendEntry }
}
