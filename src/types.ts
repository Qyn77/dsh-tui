/**
 * UI-facing types for the dsh TUI bundle. These describe the rendering tree
 * derived from the live session log, not anything that crosses the agent
 * boundary — the model still sees the canonical `SessionEvent` stream.
 * @module @deepseek-ai/dsh-tui/types
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CallId, TokenUsage, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TodoItem, TurnEndReason } from '@deepseek-ai/dsh-session'

/**
 * The bridge that ran a hook. Mirrors `HookDialect` in
 * `@deepseek-ai/dsh-hook-protocol` — see the note on {@link SessionEventMap}
 * below for why this package copies the vocabulary instead of importing it.
 */
export type HookDialect = 'claude-code' | 'codex'

/**
 * Session events the TUI renders that other plugins add to `SessionEventMap`:
 * `@deepseek-ai/dsh-compaction` for `compaction/*`,
 * `@deepseek-ai/dsh-plan-mode` for `plan/mode`, and
 * `@deepseek-ai/dsh-hook-protocol` for `hook/*`.
 *
 * None of those three is a dependency of this package, which is the point.
 * `dsh-base` mounts no hook bridge and does not depend on one, so a hard peer
 * would make every install warn about a package most assemblies will never
 * have — for a feature that draws nothing until a user inserts a bridge. The
 * TUI instead renders whatever shows up on the session it is already reading,
 * the same way it renders MCP-bridged tools by parsing their names and
 * depending on `dsh-mcp-client` not at all (`docs/SPEC.md` §1.12).
 *
 * The cost is that these declarations are copies and can drift. For `hook/*`
 * the copy is verbatim from `packages/hooks/hook-protocol/lib/types/types.d.ts`
 * at `0.1.0-rc.7`, which is the version line this package pins; a drift shows
 * up as a field the renderer reads and no emitter sets, i.e. `undefined`, which
 * every branch below already handles.
 */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'compaction/start': { trigger: 'auto' | 'manual' }
    'compaction/summary': { tokensBefore: number; tokensAfter: number }
    'compaction/prune': { removedSeqs: readonly number[] }
    'compaction/end': { ok: boolean }
    'plan/mode': { enabled: boolean }
    'hook/invoked': {
      turn: number
      point: string
      dialect: HookDialect
      matcher?: string
      handlerId: string
    }
    'hook/result': {
      turn: number
      point: string
      handlerId: string
      decision: string
      exitCode?: number
      stderrSummary?: string
      durationMs: number
    }
  }
}

/**
 * Fate of a tool call.
 *
 * `cancelled` is not a failure: it means the turn ended while the call was
 * still in flight, so no result was ever reported. It exists because the
 * alternative was claiming `ok` for a tool the user interrupted — see the
 * `turn/end` case in `state.ts`. The glyph and color are fixed by
 * `docs/SPEC.md` §1.4.
 */
export type ToolStatus = 'running' | 'ok' | 'error' | 'cancelled'

/** Visible entry in the chat list. The reducer grows a list of these. */
export type UiEntry =
  | { kind: 'user'; message: UserMessage }
  | {
    kind: 'assistant'
    turn: number
    step: number
    text: string
    finalized: boolean
    usage?: TokenUsage
  }
  | {
    kind: 'tool'
    callId: CallId
    name: string
    args: string
    turn: number
    step: number
    result?: ToolResultMessage
    error?: { name: string; code: string }
    status: ToolStatus
  }
  | { kind: 'compaction'; stage: 'start' | 'summary' | 'end' | 'prune'; text?: string }
  | { kind: 'plan'; enabled: boolean; at: number }
  /**
   * One hook run, opened by `hook/invoked` and closed by `hook/result`.
   *
   * Paired on `handlerId` rather than on "the most recent open one", which is
   * how {@link ToolStatus} entries are closed. The events carry the id
   * precisely so a pair can be correlated, and hooks at one point run as a
   * group — several may be open at once, so the tool heuristic would close the
   * wrong row.
   *
   * `status` exists for the same reason it does on a tool: an invocation whose
   * result never arrives must not keep claiming to be running. The protocol
   * documents the pair as turn-enclosed, so `turn/end` is where that is
   * settled.
   *
   * `decision` is deliberately a bare `string`. The emitter types it that way
   * because the vocabulary is open — `pass`, `stop`, and the five values a hook
   * can express (`approve`/`allow`/`block`/`deny`/`ask`) are what exist today,
   * and a bridge may add to it. See `hookTone` in `hook-runs.ts` for what an
   * unrecognized one is treated as.
   */
  | {
    kind: 'hook'
    /** Correlates this row's `hook/invoked` with its `hook/result`. */
    handlerId: string
    /** The hook point (`PreToolUse`, `Stop`, …) — the emitter's word, untranslated. */
    point: string
    dialect: HookDialect
    turn: number
    /** The matcher-group pattern that selected it; absent for match-all. */
    matcher?: string
    /** Set by `hook/result`. Absent while the run is still open. */
    decision?: string
    exitCode?: number
    stderrSummary?: string
    durationMs?: number
    status: 'running' | 'done' | 'cancelled'
  }
  /**
   * The model's task list, as of the most recent `todo/write`.
   *
   * The event carries a whole-list snapshot and the protocol declares
   * latest-write-wins on replay, so this entry holds the list itself rather
   * than a diff — there is no incremental state to keep.
   *
   * Consecutive writes collapse into one entry (see the `todo/write` case in
   * `state.ts`) instead of appending a near-identical copy per checked box.
   * The list is *current state*, not an event, and a transcript that repeated
   * it once per item would bury the conversation it belongs to.
   */
  | { kind: 'todo'; todos: readonly TodoItem[] }
  /**
   * A free-floating remark. `tone` is what keeps a failed turn from looking
   * like a compaction notice: untoned notes are incidental and dim, an
   * `error` note is a turn that failed, and a `warn` note is a turn the user
   * or the runtime stopped on purpose.
   */
  | { kind: 'note'; text: string; tone?: 'error' | 'warn' }
  /**
   * Context the runtime handed the model on the user's behalf.
   *
   * `plugin`/`form` describe a plugin injection and `skill` a user-explicit
   * skill invocation; they are mutually exclusive, and a row that has neither
   * is an injection from a source this surface has no vocabulary for yet.
   *
   * A skill row carries no `preview` on purpose. The payload is a rendered
   * `<skill_content>` block, and `@deepseek-ai/dsh-skill` puts the name in the
   * message source precisely so consumers label the row from metadata instead
   * of sampling model-facing markup at the user.
   */
  | { kind: 'runtime-context'; plugin?: string; form?: string; skill?: string; preview: string }
  /**
   * A slash command and what it printed. Commands never reach the model, so
   * they produce no session event and the reducer cannot mint this — it is
   * appended locally by the App (see `useSessionEvents`' `appendEntry`).
   *
   * It lives in the log rather than on stderr because the REPL runs inside
   * the alternate screen: a stderr write there is either erased by Ink's next
   * frame or interleaved into one, which is how `/help` and `/status` came to
   * print nothing a user could read.
   */
  | { kind: 'command'; input: string; text: string; failed: boolean }
  /**
   * A `!` shell escape and what it printed. Like `command`, this is appended
   * locally rather than projected from an event — a `!` command runs outside the
   * session entirely.
   *
   * The outcome is kept in fields rather than baked into `output` so the
   * "exit 1" / "timed out" / "truncated" suffixes stay translatable and stay out
   * of the state layer. `output` is the program's own bytes and is never
   * localized.
   */
  | {
    kind: 'shell'
    /** The line as typed, without the sigil. */
    command: string
    /** Interleaved stdout and stderr, already clamped. */
    output: string
    /** `null` when the child died from a signal, or could not start at all. */
    exitCode: number | null
    signal?: string
    timedOut: boolean
    truncated: boolean
    /** `true` when the command and its output were queued for the model (`!!`). */
    injected: boolean
  }

/**
 * State shape held by the TUI.
 *
 * `entries` and `status` are the two fields the render tree actually reads.
 * `currentTurn` and `lastReason` are projected faithfully from the log but have
 * no renderer, deliberately: a turn counter in the status bar tells the user
 * something they can already count in the log, and the number that *would* be
 * worth showing during a long turn is the step, which the session does not
 * surface. Both are kept because they are the honest projection of the events
 * and because dropping a field from an exported interface in an `rc` line is a
 * breaking change for no gain. Do not read this as "wiring in progress".
 */
export interface UiState {
  entries: UiEntry[]
  /** Current agent status. Drives the spinner and the `working`/`idle` label. */
  status: 'idle' | 'running'
  /** Turn number of the most recent `turn/start`. Projection only — nothing renders it. */
  currentTurn: number
  /** Reason carried by the most recent `turn/end`. Projection only — nothing renders it. */
  lastReason?: TurnEndReason
}

/**
 * The text a user message carries, with any non-text blocks left out.
 *
 * A user message is usually one text block, but not always: attaching an image
 * puts `image` blocks beside it (see {@link userMessageImages}), and a message
 * that is *only* an image has no text at all. Callers that draw the message
 * must handle the empty string rather than assuming a line is there.
 */
export function userMessageText(message: UserMessage): string {
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

/**
 * The images a user message carries, in content order.
 *
 * Read off the message rather than tracked beside it, which is what makes a
 * resumed transcript draw its attachments: the refs are in the durable log's
 * own `user/message` event, so replay needs no extra state.
 */
export function userMessageImages(message: UserMessage): ImageAttachmentRef[] {
  return message.content
    .filter((b): b is { type: 'image'; attachment: ImageAttachmentRef } => b.type === 'image')
    .map(b => b.attachment)
}

/** Filter the session log down to only the events the TUI cares about. */
export function isRenderable(event: SessionEvent): boolean {
  switch (event.type) {
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'user/message':
    case 'assistant/chunk':
    case 'assistant/message':
    case 'tool/call':
    case 'tool/result':
    case 'compaction/start':
    case 'compaction/end':
    case 'compaction/summary':
    case 'compaction/prune':
    case 'plan/mode':
    case 'hook/invoked':
    case 'hook/result':
    case 'todo/write':
    case 'agent/inbox/spliced':
    case 'session/end-seed':
      return true
    default:
      return false
  }
}
