/**
 * UI-facing types for the dsh TUI bundle. These describe the rendering tree
 * derived from the live session log, not anything that crosses the agent
 * boundary — the model still sees the canonical `SessionEvent` stream.
 * @module @deepseek-ai/dsh-tui/types
 */

import type { CallId, TokenUsage, ToolResultMessage, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'

/**
 * Pull in session events the TUI renders but that are added to
 * `SessionEventMap` by other plugins (`@deepseek-ai/dsh-compaction` for
 * `compaction/*`, `@deepseek-ai/dsh-plan-mode` for `plan/mode`). The empty
 * type imports carry their declaration merging into this module.
 */
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'compaction/start': { trigger: 'auto' | 'manual' }
    'compaction/summary': { tokensBefore: number; tokensAfter: number }
    'compaction/prune': { removedSeqs: readonly number[] }
    'compaction/end': { ok: boolean }
    'plan/mode': { enabled: boolean }
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
   * A free-floating remark. `tone` is what keeps a failed turn from looking
   * like a compaction notice: untoned notes are incidental and dim, an
   * `error` note is a turn that failed, and a `warn` note is a turn the user
   * or the runtime stopped on purpose.
   */
  | { kind: 'note'; text: string; tone?: 'error' | 'warn' }
  | { kind: 'runtime-context'; plugin?: string; form?: string; preview: string }
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

/** State shape held by the TUI. */
export interface UiState {
  entries: UiEntry[]
  /** Current agent status. */
  status: 'idle' | 'running'
  /** Current turn number when the agent is running. */
  currentTurn: number
  /** Last seen `turn/end` reason (for the spinner → idle transition). */
  lastReason?: TurnEndReason
}

/** A user message is a single text block today; helper for the prompt. */
export function userMessageText(message: UserMessage): string {
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
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
    case 'agent/inbox/spliced':
    case 'session/end-seed':
      return true
    default:
      return false
  }
}
