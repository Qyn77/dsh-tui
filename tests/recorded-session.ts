import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'

const logs = new WeakMap<Session, SessionEvent[]>()

/** Record the same committed event feed a persistence backend receives. */
export function recordedSession(id: string, seed?: readonly SessionEvent[]): Session {
  const events = [...(seed ?? [])]
  if (seed && events.at(-1)?.type !== 'session/end-seed') {
    events.push({ type: 'session/end-seed', seq: SessionSeq(events.length), time: 0, data: {} })
  }
  const session = Session.create(SessionId(id), seed ? events : undefined)
  const ctx = new Context()
  ctx.on('session/event', (_owner, event) => { events.push(event) })
  new SessionStore(ctx).enter(session)
  logs.set(session, events)
  return session
}

export function recordedEvents(session: Session): readonly SessionEvent[] {
  const events = logs.get(session)
  if (!events) throw new Error('session was not attached to the test recorder')
  return events
}
