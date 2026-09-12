/**
 * The `/model ` picker: model rows, the anchored query token, and the two
 * ways a choice leaves the list.
 *
 * The third command-anchored picker after `/skill ` and `/permission `, and
 * the first whose rows need **provider I/O**: `llm.listModels(provider)` is a
 * network round-trip, so rows arrive asynchronously the way the skill
 * catalog's do (`useModelCommands`), not synchronously the way the permission
 * projection reads. Like a preset row, a model row is an *argument* to its
 * command — the row's name is the bare model id, because a bare id is what
 * `/model` accepts against the current provider, and Enter submits
 * `/model <id>` through the ordinary dispatch.
 *
 * No `llm` service mounted, no selection, or a failed listing means no rows,
 * which means no picker — the same dark-feature stance as the other two.
 * @module @deepseek-ai/dsh-tui/pickers/model-picker
 */

import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { CommandMeta } from '../commands/commands.ts'
import { anchoredTokenAt } from '../prompt/prompt-editing.ts'

/** The literal prefix the picker anchors on; {@link ModelMention.start} is its length. */
export const MODEL_PREFIX = '/model '

/**
 * Marks the model the session is already on. Same mark, same meaning, as the
 * permission picker's `✓`: the one row that is already in force.
 */
export const CURRENT_MODEL_GLYPH = '✓'

/** A `/model <token>` query in the buffer: what it asks for, and what it occupies. */
export interface ModelMention {
  /** The token typed after `/model `, which may be empty right after the space. */
  query: string
  /** Index the query token starts at — the position after `/model `. */
  start: number
  /** Index one past the token's last character. */
  end: number
}

/**
 * Map a provider's advertised models into picker rows.
 *
 * The row's **name is the bare model id** — that is what gets typed after
 * `/model`, and what Enter submits; a `provider/id` form would make every row
 * longer to say what the picker's scope already implies (the current
 * provider's catalogue). The description is the provider's own display name
 * for the model, shown as written; the model the session is currently on
 * carries {@link CURRENT_MODEL_GLYPH} so the list answers "what am I on"
 * before it answers "what can I pick".
 * @param models - the provider's catalogue, in adapter-preferred order.
 * @param current - the model id the session is on, if selection is known.
 * @returns one row per advertised model, catalogue order preserved.
 */
export function modelRows(
  models: readonly LlmModelInfo[],
  current: string | undefined,
): CommandMeta[] {
  return models.map(model => ({
    name: model.id,
    description: model.id === current
      ? `${CURRENT_MODEL_GLYPH} ${model.name}`
      : model.name,
  }))
}

/**
 * Find the `/model ` query token the caret is in, if any.
 *
 * The grammar is the shared command-anchored one (`anchoredTokenAt`).
 * @param buffer - the prompt buffer.
 * @param cursor - the caret's index into it.
 * @returns the query token, or `undefined` when the caret is not in one.
 */
export function modelMentionAt(buffer: string, cursor: number): ModelMention | undefined {
  return anchoredTokenAt(buffer, cursor, MODEL_PREFIX)
}

/**
 * The line choosing a model submits. Enter's answer — the switch happens
 * through the ordinary `/model` dispatch, so it keeps its echo, its
 * validation and its busy-check.
 * @param id - a row's bare model id.
 * @returns the full command line, e.g. `/model deepseek-v4`.
 */
export function modelCommandLine(id: string): string {
  return `/model ${id}`
}

/**
 * Replace the `/model <token>` query with the chosen model, leaving a space.
 * Tab's answer: the line is completed but not sent, so the choice can be read
 * before Enter dispatches it.
 * @returns the new buffer and where the caret should sit in it.
 */
export function applyModelMention(
  buffer: string,
  mention: ModelMention,
  id: string,
): { text: string; cursor: number } {
  const head = `${MODEL_PREFIX}${id} `
  return { text: head + buffer.slice(mention.end), cursor: head.length }
}

/**
 * Filter model rows by the typed token.
 *
 * Case-insensitive **prefix** match on the bare id, same rule the other
 * command pickers use: a model id is a short token, and a prefix is what the
 * person typing one means. Rows arrive in catalogue order and leave in it;
 * the floating palette does the windowing.
 * @param rows - the candidate rows, named by bare model id.
 * @param query - the token typed after `/model `.
 * @returns the matching rows, input order preserved.
 */
export function filterModelRows(rows: readonly CommandMeta[], query: string): CommandMeta[] {
  const wanted = query.toLowerCase()
  return rows.filter(row => row.name.toLowerCase().startsWith(wanted))
}
