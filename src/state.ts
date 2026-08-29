/**
 * Pure reducer for session events → UI state. Kept side-effect free so it is
 * trivial to test without booting a Cordis tree.
 * @module @deepseek-ai/dsh-tui/state
 */

import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
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

/** The member of {@link SessionEvent} carrying one `type`. */
type EventOf<T extends SessionEvent['type']> = Extract<SessionEvent, { type: T }>

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

/** Append one entry to the projected list. */
function append(state: UiState, entry: UiEntry): UiEntry[] {
  return [...state.entries, entry]
}

/**
 * The status a tool entry inherits when the turn ends while it is still
 * `running`. Such a tool never reported a result, so its fate has to be read
 * off the reason the turn ended for. This used to be an unconditional `ok`,
 * which meant a tool the user cut off with Ctrl-C rendered as a completed one —
 * the transcript claimed work had finished that never did. Anything other than
 * a clean completion or an outright error is `cancelled`: not a failure, just
 * never finished.
 */
function unfinishedToolStatus(reason: TurnEndReason): ToolStatus {
  if (reason.kind === 'completed') return 'ok'
  if (reason.kind === 'error') return 'error'
  return 'cancelled'
}

/**
 * The note a finished turn leaves in the log, or `undefined` for a clean
 * completion. A failed turn is red and a stopped one is yellow: left untoned
 * they were dim gray, i.e. visually identical to a compaction notice, which is
 * the wrong weight for the two states the user most needs to notice.
 */
function turnEndNote(
  turn: number,
  reason: TurnEndReason,
): { text: string; tone: 'error' | 'warn' } | undefined {
  switch (reason.kind) {
    case 'completed':
      return undefined
    case 'aborted':
      return { text: `[turn ${turn} aborted]`, tone: 'warn' }
    case 'error':
      return { text: `[turn ${turn} errored: ${reason.error.code}]`, tone: 'error' }
    case 'interrupted':
      return { text: `[turn ${turn} interrupted]`, tone: 'warn' }
    default:
      return { text: `[turn ${turn} ended: ${reason.kind}]`, tone: 'warn' }
  }
}

/** Close out a turn: finalize whatever is still in flight, then note why it ended. */
function onTurnEnd(state: UiState, event: EventOf<'turn/end'>): UiState {
  const reason = event.data.reason
  const unfinished = unfinishedToolStatus(reason)
  const entries = state.entries.map((e): UiEntry => {
    if (e.kind === 'assistant' && !e.finalized) return { ...e, finalized: true }
    if (e.kind === 'tool' && e.status === 'running') return { ...e, status: unfinished }
    return e
  })
  const note = turnEndNote(event.data.turn, reason)
  return {
    ...state,
    entries: note ? pushNote(entries, note.text, note.tone) : entries,
    status: 'idle',
    lastReason: reason,
  }
}

/** Project a user-role message as either the human's prompt or a runtime injection. */
function onUserMessage(state: UiState, event: EventOf<'user/message'>): UiState {
  const msg = event.data
  if (!isRuntimeContext(msg)) {
    return { ...state, entries: append(state, { kind: 'user', message: msg }) }
  }
  // Synthetic injection (plugin source, or any non-`user` source on
  // a user-role message). Surface as a `runtime-context` row so
  // the user can see the model received context, without the chat
  // surface mislabeling it as a "you" message.
  const plugin = msg.source.kind === 'plugin' ? msg.source.plugin : undefined
  const form = msg.source.kind === 'plugin' ? msg.source.form : undefined
  return {
    ...state,
    entries: append(state, {
      kind: 'runtime-context',
      ...(plugin !== undefined ? { plugin } : {}),
      ...(form !== undefined ? { form } : {}),
      preview: previewText(msg, 80),
    }),
  }
}

/** Stream one delta into the assistant entry for its `(turn, step)`. */
function onAssistantChunk(state: UiState, event: EventOf<'assistant/chunk'>): UiState {
  const { turn, step, chunk } = event.data
  if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return state
  const found = findLast(state.entries, assistantAt(turn, step))
  if (found) {
    const next: UiEntry = { ...found.entry, text: found.entry.text + chunk.text }
    return { ...state, entries: replaceAt(state.entries, found.index, next) }
  }
  return {
    ...state,
    entries: append(state, { kind: 'assistant', turn, step, text: chunk.text, finalized: false }),
  }
}

/** Seal the assistant entry for its `(turn, step)`, attaching usage if the event carried it. */
function onAssistantMessage(state: UiState, event: EventOf<'assistant/message'>): UiState {
  const { turn, step, message, usage } = event.data
  const found = findLast(state.entries, assistantAt(turn, step))
  const text = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
  if (found) {
    const next: UiEntry = {
      ...found.entry,
      // An empty message keeps whatever the deltas already built.
      text: text || found.entry.text,
      finalized: true,
      ...(usage ? { usage } : {}),
    }
    return { ...state, entries: replaceAt(state.entries, found.index, next) }
  }
  return {
    ...state,
    entries: append(state, {
      kind: 'assistant',
      turn,
      step,
      text,
      finalized: true,
      ...(usage ? { usage } : {}),
    }),
  }
}

/** Open a tool entry in the `running` state; `tool/result` closes it. */
function onToolCall(state: UiState, event: EventOf<'tool/call'>): UiState {
  return {
    ...state,
    entries: append(state, {
      kind: 'tool',
      callId: event.data.callId,
      name: event.data.name,
      args: event.data.arguments,
      turn: event.data.turn,
      step: event.data.step,
      status: 'running',
    }),
  }
}

/** Close the tool entry this result belongs to. */
function onToolResult(state: UiState, event: EventOf<'tool/result'>): UiState {
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

/**
 * Move an open compaction row to its next stage, or start a fresh row when the
 * event arrives with nothing to advance — a resumed session can join a
 * compaction midway. `match` is what separates the two callers: `summary`
 * upgrades the row that opened *this* compaction, while `end` closes whichever
 * compaction row is most recent.
 */
function advanceCompaction(
  state: UiState,
  stage: 'summary' | 'end',
  match: (entry: UiEntry) => entry is EntryOf<'compaction'>,
): UiState {
  const found = findLast(state.entries, match)
  if (!found) return { ...state, entries: append(state, { kind: 'compaction', stage }) }
  const replaced: UiEntry = { ...found.entry, stage }
  return { ...state, entries: replaceAt(state.entries, found.index, replaced) }
}

/**
 * Apply a single session event to a state. Every branch that needs more than
 * one expression lives in its own function above, so this reads as the routing
 * table it is — and so `turn/end`'s two decision ladders are not sharing a
 * scope with `case 'step/start': return state`.
 */
export function reduce(state: UiState, event: SessionEvent): UiState {
  switch (event.type) {
    case 'session/end-seed':
      // Wipe the projected view above the seed boundary so the user only sees
      // the live work; this matters for resumed sessions.
      return { ...state, entries: [] }

    case 'turn/start':
      return { ...state, status: 'running', currentTurn: event.data.turn }

    case 'turn/end':
      return onTurnEnd(state, event)

    case 'user/message':
      return onUserMessage(state, event)

    case 'assistant/chunk':
      return onAssistantChunk(state, event)

    case 'assistant/message':
      return onAssistantMessage(state, event)

    case 'tool/call':
      return onToolCall(state, event)

    case 'tool/result':
      return onToolResult(state, event)

    case 'compaction/start':
      return { ...state, entries: append(state, { kind: 'compaction', stage: 'start' }) }

    case 'compaction/summary':
      return advanceCompaction(state, 'summary', isCompactionStart)

    case 'compaction/prune':
      return { ...state, entries: append(state, { kind: 'compaction', stage: 'prune' }) }

    case 'compaction/end':
      return advanceCompaction(state, 'end', isCompaction)

    case 'plan/mode':
      return {
        ...state,
        entries: append(state, { kind: 'plan', enabled: event.data.enabled, at: event.seq }),
      }

    // Carried in the log but with nothing to project: step boundaries are
    // implied by the assistant entries between them, and inbox splices are
    // pure bookkeeping.
    case 'step/start':
    case 'step/end':
    case 'agent/inbox/spliced':
      return state

    default:
      return state
  }
}

/** Apply a sequence of events. */
export function replay(events: readonly SessionEvent[]): UiState {
  return events.reduce(reduce, initialState())
}
