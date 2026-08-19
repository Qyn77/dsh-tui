/**
 * Pure reducer for session events → UI state. Kept side-effect free so it is
 * trivial to test without booting a Cordis tree.
 * @module @deepseek-ai/dsh-tui/state
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UiEntry, UiState } from './types.ts'

/** Initial state. */
export function initialState(): UiState {
  return { entries: [], status: 'idle', currentTurn: 0 }
}

/** Append a textual note to the chat list. */
function pushNote(entries: UiEntry[], text: string): UiEntry[] {
  return [...entries, { kind: 'note', text }]
}

/** Find the last assistant entry matching (turn, step) and return its index. */
function findAssistant(entries: UiEntry[], turn: number, step: number): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i]
    if (e && e.kind === 'assistant' && e.turn === turn && e.step === step) return i
  }
  return -1
}

/** Find the most recent still-running tool entry. */
function findLastRunningTool(entries: UiEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i]
    if (e && e.kind === 'tool' && e.status === 'running') return i
  }
  return -1
}

/** Apply a single session event to a state. */
export function reduce(state: UiState, event: SessionEvent): UiState {
  switch (event.type) {
    case 'session/end-seed':
      // Wipe the projected view above the seed boundary so the user only sees
      // the live work; this matters for resumed sessions.
      return { ...state, entries: [] }

    case 'turn/start': {
      return { ...state, status: 'running', currentTurn: event.data.turn }
    }

    case 'turn/end': {
      // Finalize any in-flight assistant or tool entry.
      const entries = state.entries.map((e): UiEntry => {
        if (e.kind === 'assistant' && !e.finalized) return { ...e, finalized: true }
        if (e.kind === 'tool' && e.status === 'running') return { ...e, status: 'ok' }
        return e
      })
      const reason = event.data.reason
      const text = reason.kind === 'completed'
        ? undefined
        : reason.kind === 'aborted'
          ? `[turn ${event.data.turn} aborted]`
          : reason.kind === 'error'
            ? `[turn ${event.data.turn} errored: ${reason.error.code}]`
            : reason.kind === 'interrupted'
              ? `[turn ${event.data.turn} interrupted]`
              : `[turn ${event.data.turn} ended: ${reason.kind}]`
      return {
        ...state,
        entries: text ? pushNote(entries, text) : entries,
        status: 'idle',
        lastReason: reason,
      }
    }

    case 'step/start':
    case 'step/end':
      return state

    case 'user/message': {
      return { ...state, entries: [...state.entries, { kind: 'user', message: event.data }] }
    }

    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      const idx = findAssistant(state.entries, turn, step)
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        if (idx >= 0) {
          const existing = state.entries[idx] as Extract<UiEntry, { kind: 'assistant' }>
          const next: UiEntry = { ...existing, text: existing.text + chunk.text }
          const entries = state.entries.slice()
          entries[idx] = next
          return { ...state, entries }
        }
        return {
          ...state,
          entries: [
            ...state.entries,
            { kind: 'assistant', turn, step, text: chunk.text, finalized: false },
          ],
        }
      }
      return state
    }

    case 'assistant/message': {
      const { turn, step, message, usage } = event.data
      const idx = findAssistant(state.entries, turn, step)
      const text = message.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('')
      if (idx >= 0) {
        const existing = state.entries[idx] as Extract<UiEntry, { kind: 'assistant' }>
        const next: UiEntry = {
          ...existing,
          text: text || existing.text,
          finalized: true,
          ...(usage ? { usage } : {}),
        }
        const entries = state.entries.slice()
        entries[idx] = next
        return { ...state, entries }
      }
      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: 'assistant', turn, step, text, finalized: true, ...(usage ? { usage } : {}) },
        ],
      }
    }

    case 'tool/call': {
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            kind: 'tool',
            callId: event.data.callId,
            name: event.data.name,
            args: event.data.arguments,
            turn: event.data.turn,
            step: event.data.step,
            status: 'running',
          },
        ],
      }
    }

    case 'tool/result': {
      // `tool/result` does not carry its call id; the log ordering guarantees
      // the result immediately follows its call, so the most recent running
      // tool is the one this result closes.
      const idx = findLastRunningTool(state.entries)
      if (idx < 0) return state
      const existing = state.entries[idx] as Extract<UiEntry, { kind: 'tool' }>
      const next: UiEntry = {
        ...existing,
        result: event.data.message,
        ...(event.data.error ? { error: event.data.error } : {}),
        status: event.data.error ? 'error' : 'ok',
      }
      const entries = state.entries.slice()
      entries[idx] = next
      return { ...state, entries }
    }

    case 'compaction/start':
      return {
        ...state,
        entries: [...state.entries, { kind: 'compaction', stage: 'start' }],
      }

    case 'compaction/summary': {
      const idx = [...state.entries].reverse().findIndex(
        (e): e is Extract<UiEntry, { kind: 'compaction' }> =>
          e.kind === 'compaction' && e.stage === 'start',
      )
      if (idx < 0) {
        return {
          ...state,
          entries: [...state.entries, { kind: 'compaction', stage: 'summary' }],
        }
      }
      const realIdx = state.entries.length - 1 - idx
      const target = state.entries[realIdx] as Extract<UiEntry, { kind: 'compaction' }>
      const replaced: UiEntry = { ...target, stage: 'summary' }
      const entries = state.entries.slice()
      entries[realIdx] = replaced
      return { ...state, entries }
    }

    case 'compaction/prune': {
      return {
        ...state,
        entries: [...state.entries, { kind: 'compaction', stage: 'prune' }],
      }
    }

    case 'compaction/end': {
      const idx = [...state.entries].reverse().findIndex(
        (e): e is Extract<UiEntry, { kind: 'compaction' }> => e.kind === 'compaction',
      )
      if (idx < 0) {
        return {
          ...state,
          entries: [...state.entries, { kind: 'compaction', stage: 'end' }],
        }
      }
      const realIdx = state.entries.length - 1 - idx
      const target = state.entries[realIdx] as Extract<UiEntry, { kind: 'compaction' }>
      const replaced: UiEntry = { ...target, stage: 'end' }
      const entries = state.entries.slice()
      entries[realIdx] = replaced
      return { ...state, entries }
    }

    case 'plan/mode':
      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: 'plan', enabled: event.data.enabled, at: event.seq },
        ],
      }

    case 'agent/inbox/spliced':
      // Pure inbox bookkeeping; nothing to render.
      return state

    default:
      return state
  }
}

/** Apply a sequence of events. */
export function replay(events: readonly SessionEvent[]): UiState {
  return events.reduce(reduce, initialState())
}
