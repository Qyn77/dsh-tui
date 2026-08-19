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
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SessionEventMap {
    'compaction/start': { trigger: 'auto' | 'manual' }
    'compaction/summary': { tokensBefore: number; tokensAfter: number }
    'compaction/prune': { removedSeqs: readonly number[] }
    'compaction/end': { ok: boolean }
    'plan/mode': { enabled: boolean }
  }
}

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
      status: 'running' | 'ok' | 'error'
    }
  | { kind: 'compaction'; stage: 'start' | 'summary' | 'end' | 'prune'; text?: string }
  | { kind: 'plan'; enabled: boolean; at: number }
  | { kind: 'note'; text: string }

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
