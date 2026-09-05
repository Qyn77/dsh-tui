/**
 * Pure reducer for session events → UI state. Kept side-effect free so it is
 * trivial to test without booting a Cordis tree.
 * @module @deepseek-ai/dsh-tui/state
 */

import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolStatus, UiEntry, UiState } from './types.ts'
import { SHELL_SOURCE_PLUGIN } from './shell.ts'

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

/**
 * Match the open hook run one `hook/result` belongs to.
 *
 * By `handlerId`, not by "the most recent open one" the way `tool/result` is
 * matched. That heuristic is forced on the tool path because `tool/result`
 * carries no call id; here the id is in both halves of the pair precisely so
 * they can be correlated, and hooks matched to one point run as a group — with
 * several open at once, closing the newest would attribute one hook's decision
 * to another's row.
 */
function openHookRun(handlerId: string): (entry: UiEntry) => entry is EntryOf<'hook'> {
  return (entry): entry is EntryOf<'hook'> =>
    entry.kind === 'hook' && entry.status === 'running' && entry.handlerId === handlerId
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
/**
 * The note a finished turn leaves behind, or `undefined` when it ended
 * cleanly and there is nothing to say.
 *
 * Every ending the session *names* gets its own wording, because the name is
 * vocabulary from the event log and not something a user should have to
 * decode. `[turn 3 ended: blocked]` is accurate and useless; a rejection the
 * turn never recovered from is worth saying in words. The `default` arm stays
 * because `TurnEndReasonMap` is merge-extensible — a backend can add an ending
 * this build has never heard of, and printing its `kind` is the honest thing to
 * do with a fact we cannot phrase.
 */
function turnEndNote(
  turn: number,
  reason: TurnEndReason,
): { text: string; tone: 'error' | 'warn' } | undefined {
  // Read the tag once, widened to `string`, for the `default` arm to print.
  // Every variant this build's types declare is named below, which makes
  // `reason` itself `never` down there — a merge-extended variant is
  // precisely the case the compiler cannot see and this local preserves.
  const kind: string = reason.kind
  switch (reason.kind) {
    case 'completed':
      return undefined
    case 'aborted':
      return { text: `[turn ${turn} aborted]`, tone: 'warn' }
    case 'error':
      return { text: `[turn ${turn} errored: ${reason.error.code}]`, tone: 'error' }
    case 'interrupted':
      return { text: `[turn ${turn} interrupted]`, tone: 'warn' }
    // A pre-step rejection: the turn was refused before it reached the model,
    // and the messages it had claimed were discarded with it. Saying "nothing
    // ran" is the part the user needs — a retry is theirs to make, and without
    // this they cannot tell a blocked turn from a silent one.
    case 'blocked':
      return { text: `[turn ${turn} blocked before it ran]`, tone: 'warn' }
    // The reply exists and is simply cut off at the output ceiling. That is a
    // different situation from every other ending here, all of which mean the
    // work is gone, so it must not read as a failure.
    case 'max-tokens':
      return { text: `[turn ${turn} hit the output limit — reply truncated]`, tone: 'warn' }
    default:
      return { text: `[turn ${turn} ended: ${kind}]`, tone: 'warn' }
  }
}

/** Close out a turn: finalize whatever is still in flight, then note why it ended. */
function onTurnEnd(state: UiState, event: EventOf<'turn/end'>): UiState {
  const reason = event.data.reason
  const unfinished = unfinishedToolStatus(reason)
  const entries = state.entries.map((e): UiEntry => {
    if (e.kind === 'assistant' && !e.finalized) return { ...e, finalized: true }
    if (e.kind === 'tool' && e.status === 'running') return { ...e, status: unfinished }
    // A hook run open at the turn boundary is `cancelled` whatever the reason,
    // where an open tool inherits the turn's fate. The protocol documents the
    // invoked/result pair as turn-enclosed, so a missing result is not the
    // ordinary consequence of a turn ending — it means the pair broke, and the
    // one thing that cannot be claimed is a decision that was never recorded.
    // `unfinishedToolStatus` maps a clean completion to `ok`; borrowing it here
    // would print `pass` for a hook whose verdict is simply unknown.
    if (e.kind === 'hook' && e.status === 'running') return { ...e, status: 'cancelled' }
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
  // A skill invocation names itself in its source. Reading that is the whole
  // reason the source variant exists — the payload is a `<skill_content>`
  // block, so previewing it would show the user the markup instead of the
  // fact that `/review` ran.
  const skill = msg.source.kind === 'skill-invocation' ? msg.source.name : undefined
  // Our own injections are already on screen. A `!!` escape draws its shell row
  // the moment the command finishes; the injection is claimed at the next
  // pre-step, and projecting it too would show the same command and the same
  // output twice, minutes apart, as if the runtime had contributed something new.
  if (plugin === SHELL_SOURCE_PLUGIN) return state
  return {
    ...state,
    entries: append(state, {
      kind: 'runtime-context',
      ...(plugin !== undefined ? { plugin } : {}),
      ...(form !== undefined ? { form } : {}),
      ...(skill !== undefined ? { skill } : {}),
      preview: skill === undefined ? previewText(msg, 80) : '',
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

/** Open a hook row; the matching `hook/result` closes it. */
function onHookInvoked(state: UiState, event: EventOf<'hook/invoked'>): UiState {
  const { turn, point, dialect, handlerId, matcher } = event.data
  return {
    ...state,
    entries: append(state, {
      kind: 'hook',
      handlerId,
      point,
      dialect,
      turn,
      ...(matcher !== undefined ? { matcher } : {}),
      status: 'running',
    }),
  }
}

/**
 * Close the hook row this result belongs to.
 *
 * A result with no open row is dropped rather than opening one. That is the
 * opposite of how `compaction/end` behaves, and the difference is what a
 * resumed session can join midway: a compaction is one long-running operation
 * whose end is worth showing on its own, while a hook run is over in
 * milliseconds and a row reading "a hook you never saw start has finished"
 * describes nothing the user can act on.
 */
function onHookResult(state: UiState, event: EventOf<'hook/result'>): UiState {
  const { handlerId, decision, exitCode, stderrSummary, durationMs } = event.data
  const found = findLast(state.entries, openHookRun(handlerId))
  if (!found) return state
  const next: UiEntry = {
    ...found.entry,
    decision,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(stderrSummary !== undefined ? { stderrSummary } : {}),
    durationMs,
    status: 'done',
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
 * Project the model's task list, collapsing a run of writes into one entry.
 *
 * `todo/write` carries a whole-list snapshot, so nothing has to be merged. The
 * only real decision is placement, and it is made here rather than in the
 * component: the list is replaced *in place* when it is already the newest
 * entry, and appended fresh otherwise.
 *
 * That rule falls out of what the two failure modes look like. Appending every
 * write puts a near-identical copy of the list in the transcript per checked
 * box, which buries the conversation. Always replacing the one existing entry
 * leaves the list stranded wherever it first appeared — scrolled off the top
 * while the work it describes is still going. Replacing only while it is still
 * last means a burst of edits costs one row, and a write that lands after the
 * model has said something starts a new row at the bottom, where the user is
 * looking.
 *
 * A fixed panel above the prompt was the alternative and is rejected: its
 * height would be driven by a list whose length the model chooses, inside the
 * one region of the frame that has a fixed height budget. Overflow there
 * renders as overlapping frames, not as clipping.
 */
function onTodoWrite(state: UiState, event: EventOf<'todo/write'>): UiState {
  const entry: UiEntry = { kind: 'todo', todos: event.data.todos }
  const last = state.entries.at(-1)
  if (last?.kind === 'todo') {
    return { ...state, entries: replaceAt(state.entries, state.entries.length - 1, entry) }
  }
  return { ...state, entries: append(state, entry) }
}

/**
 * Apply a single session event to a state. Every branch that needs more than
 * one expression lives in its own function above, so this reads as the routing
 * table it is — and so `turn/end`'s two decision ladders are not sharing a
 * scope with `case 'step/start': return state`.
 */
export function reduce(state: UiState, event: SessionEvent): UiState {
  switch (event.type) {
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

    case 'todo/write':
      return onTodoWrite(state, event)

    case 'hook/invoked':
      return onHookInvoked(state, event)

    case 'hook/result':
      return onHookResult(state, event)

    // Carried in the log but with nothing to project: step boundaries are
    // implied by the assistant entries between them, and inbox splices are
    // pure bookkeeping.
    //
    // `session/end-seed` is the marker a resumed session's constructor appends
    // *after* the stored history, so on this side of a seed replay it arrives
    // last and wipes everything the replay just built — which was the whole
    // "resume shows a blank screen" bug. It never arrives live (constructor
    // seeds do not publish on the firehose), so the only effect a case here
    // could ever have had was erasing resumed history. A user who wants the
    // transcript to start at the live work says so with `/history off`.
    case 'step/start':
    case 'step/end':
    case 'agent/inbox/spliced':
    case 'session/end-seed':
      return state

    default:
      return state
  }
}

/** Apply a sequence of events. */
export function replay(events: readonly SessionEvent[]): UiState {
  return events.reduce(reduce, initialState())
}
