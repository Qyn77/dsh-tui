import { buildForkSeed, SessionLogOffset, type SessionEvent } from '@deepseek-ai/dsh-session'

/** Use the runtime's own fork constructor, including inherited markers/closers. */
export function branchSeed(events: readonly SessionEvent[], turn?: number): {
  seed: readonly SessionEvent[]
  inheritedEventCount: SessionLogOffset
} | undefined {
  const boundary = turn === undefined ? events.at(-1)
    : [...events].reverse().find(event => event.type === 'turn/end' && event.data.turn === turn)
  if (!boundary) return turn === undefined && events.length === 0
    ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : undefined
  return { seed: buildForkSeed(events, boundary.seq), inheritedEventCount: SessionLogOffset(boundary.seq + 1) }
}
