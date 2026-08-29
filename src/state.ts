/**
 * Pure reducer for session events → UI state. Kept side-effect free so it is
 * trivial to test without booting a Cordis tree.
 * @module @deepseek-ai/dsh-tui/state
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolStatus, UiEntry, UiState } from './types.ts'

/** Initial state. */
export function initialState(): UiState {
  return { entries: [], status: 'idle', currentTurn: 0 }
}

/**
 * True when a `user/message` event was produced by something other than
 * the human at the keyboard. Per `@deepseek-ai/dsh-session` README:
 * "its typed `source` is the only channel that tells them apart" between
 * a real human prompt and a synthetic injection. We treat anything that
 * is not `source.kind === 'user'` as runtime context — that covers
 * plugin injections (e.g. `agent-instructions` shipping
 * `<system-reminder>` content) and any future producer that supplies
 * a non-`user` source on a user-role message.
 */
export function isRuntimeContext(message: UserMessage): boolean {
  return message.source.kind !== 'user'
}

/** Pull a short text preview out of a user-role message for the runtime-context row. */
function previewText(message: UserMessage, max: number): string {
  const text = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/** Append a textual note to the chat list. */
function pushNote(entries: UiEntry[], text: string, tone?: 'error' | 'warn'): UiEntry[] {
  return [...entries, { kind: 'note', text, ...(tone ? { tone } : {}) }]
}

/** The member of {@link UiEntry} carrying one `kind`. */
type EntryOf<K extends UiEntry['kind']> = Extract<UiEntry, { kind: K }>

/** An entry found in the list, paired with the index it was found at. */
interface Located<T extends UiEntry> {
  index: number
  entry: T
}

/**
 * Scan backwards for the last entry matching `match`, returning it *with* its
 * index. Returning the entry is the point: every call site here needs to rebuild
 * the entry it found, and handing back a bare index meant reaching into
 * `entries[idx]` again and asserting the kind with `as Extract<UiEntry, …>`. Those
 * assertions were all correct, but each one held its guarantee in the distance
 * between two statements rather than in the type — change a predicate and the
 * cast keeps compiling while becoming a lie. Carrying the narrowed entry out of
 * the same `if` that checked it closes that gap.
 * @param entries - the projected chat list, newest last.
 * @param match - type predicate selecting the entry to find.
 * @returns the match and its index, or `undefined` when there is none.
 */
function findLast<T extends UiEntry>(
  entries: readonly UiEntry[],
  match: (entry: UiEntry) => entry is T,
): Located<T> | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    // No `undefined` check: `noUncheckedIndexedAccess` is off in this project,
    // so the index type is `UiEntry`, and the loop bounds make the read safe
    // anyway. Guarding here would be dead code oxlint correctly rejects.
    const entry = entries[index]
    if (match(entry)) return { index, entry }
  }
  return undefined
}

/** Copy `entries` with the item at `index` replaced. */
function replaceAt(entries: readonly UiEntry[], index: number, entry: UiEntry): UiEntry[] {
  const next = entries.slice()
  next[index] = entry
  return next
}

/** Match the assistant entry belonging to one `(turn, step)` pair. */
function assistantAt(turn: number, step: number): (entry: UiEntry) => entry is EntryOf<'assistant'> {
  return (entry): entry is EntryOf<'assistant'> =>
    entry.kind === 'assistant' && entry.turn === turn && entry.step === step
}

/** Match a tool entry that has not reported a result yet. */
function isRunningTool(entry: UiEntry): entry is EntryOf<'tool'> {
  return entry.kind === 'tool' && entry.status === 'running'
}

/** Match any compaction entry. */
function isCompaction(entry: UiEntry): entry is EntryOf<'compaction'> {
  return entry.kind === 'compaction'
}

/** Match the compaction entry that opened the current compaction. */
function isCompactionStart(entry: UiEntry): entry is EntryOf<'compaction'> {
  return entry.kind === 'compaction' && entry.stage === 'start'
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
      const reason = event.data.reason
      // A tool still marked `running` when the turn ends never reported a
      // result, so its fate has to be read off the reason the turn ended for.
      // This used to be an unconditional `ok`, which meant a tool the user cut
      // off with Ctrl-C rendered as a completed one — the transcript claimed
      // work had finished that never did. Anything other than a clean
      // completion or an outright error is `cancelled`: not a failure, just
      // never finished.
      const unfinished: ToolStatus = reason.kind === 'completed'
        ? 'ok'
        : reason.kind === 'error'
          ? 'error'
          : 'cancelled'
      // Finalize any in-flight assistant or tool entry.
      const entries = state.entries.map((e): UiEntry => {
        if (e.kind === 'assistant' && !e.finalized) return { ...e, finalized: true }
        if (e.kind === 'tool' && e.status === 'running') return { ...e, status: unfinished }
        return e
      })
      // A failed turn is red and a stopped one is yellow. Left untoned they
      // were dim gray, i.e. visually identical to a compaction notice, which
      // is the wrong weight for the two states the user most needs to notice.
      const note = reason.kind === 'completed'
        ? undefined
        : reason.kind === 'aborted'
          ? { text: `[turn ${event.data.turn} aborted]`, tone: 'warn' as const }
          : reason.kind === 'error'
            ? { text: `[turn ${event.data.turn} errored: ${reason.error.code}]`, tone: 'error' as const }
            : reason.kind === 'interrupted'
              ? { text: `[turn ${event.data.turn} interrupted]`, tone: 'warn' as const }
              : { text: `[turn ${event.data.turn} ended: ${reason.kind}]`, tone: 'warn' as const }
      return {
        ...state,
        entries: note ? pushNote(entries, note.text, note.tone) : entries,
        status: 'idle',
        lastReason: reason,
      }
    }

    case 'step/start':
    case 'step/end':
      return state

    case 'user/message': {
      const msg = event.data
      if (!isRuntimeContext(msg)) {
        return { ...state, entries: [...state.entries, { kind: 'user', message: msg }] }
      }
      // Synthetic injection (plugin source, or any non-`user` source on
      // a user-role message). Surface as a `runtime-context` row so
      // the user can see the model received context, without the chat
      // surface mislabeling it as a "you" message.
      const plugin = msg.source.kind === 'plugin' ? msg.source.plugin : undefined
      const form = msg.source.kind === 'plugin' ? msg.source.form : undefined
      return {
        ...state,
        entries: [...state.entries, {
          kind: 'runtime-context',
          ...(plugin !== undefined ? { plugin } : {}),
          ...(form !== undefined ? { form } : {}),
          preview: previewText(msg, 80),
        }],
      }
    }

    case 'assistant/chunk': {
      const { turn, step, chunk } = event.data
      if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return state
      const found = findLast(state.entries, assistantAt(turn, step))
      if (found) {
        const next: UiEntry = { ...found.entry, text: found.entry.text + chunk.text }
        return { ...state, entries: replaceAt(state.entries, found.index, next) }
      }
      return {
        ...state,
        entries: [
          ...state.entries,
          { kind: 'assistant', turn, step, text: chunk.text, finalized: false },
        ],
      }
    }

    case 'assistant/message': {
      const { turn, step, message, usage } = event.data
      const found = findLast(state.entries, assistantAt(turn, step))
      const text = message.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('')
      if (found) {
        const next: UiEntry = {
          ...found.entry,
          text: text || found.entry.text,
          finalized: true,
          ...(usage ? { usage } : {}),
        }
        return { ...state, entries: replaceAt(state.entries, found.index, next) }
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
      const found = findLast(state.entries, isRunningTool)
      if (!found) return state
      const next: UiEntry = {
        ...found.entry,
        result: event.data.message,
        ...(event.data.error ? { error: event.data.error } : {}),
        status: event.data.error ? 'error' : 'ok',
      }
      return { ...state, entries: replaceAt(state.entries, found.index, next) }
    }

    case 'compaction/start':
      return {
        ...state,
        entries: [...state.entries, { kind: 'compaction', stage: 'start' }],
      }

    case 'compaction/summary': {
      const found = findLast(state.entries, isCompactionStart)
      if (!found) {
        return {
          ...state,
          entries: [...state.entries, { kind: 'compaction', stage: 'summary' }],
        }
      }
      const replaced: UiEntry = { ...found.entry, stage: 'summary' }
      return { ...state, entries: replaceAt(state.entries, found.index, replaced) }
    }

    case 'compaction/prune': {
      return {
        ...state,
        entries: [...state.entries, { kind: 'compaction', stage: 'prune' }],
      }
    }

    case 'compaction/end': {
      const found = findLast(state.entries, isCompaction)
      if (!found) {
        return {
          ...state,
          entries: [...state.entries, { kind: 'compaction', stage: 'end' }],
        }
      }
      const replaced: UiEntry = { ...found.entry, stage: 'end' }
      return { ...state, entries: replaceAt(state.entries, found.index, replaced) }
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
