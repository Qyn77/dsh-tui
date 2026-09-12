/**
 * The `/model ` picker: model rows, the anchored query token, and the two
 * ways a choice leaves the list.
 *
 * The third command-anchored picker after `/skill ` and `/permission `, and
 * the first whose rows need **provider I/O**: `llm.listModels(provider)` is a
 * network round-trip, so rows arrive asynchronously the way the skill
 * catalog's do (`useModelCommands`), not synchronously the way the permission
 * projection reads. Like a preset row, a model row is an *argument* to its
 * command — but the row's name is the **route-qualified** `provider/id`, not
 * the bare id: the catalogue spans every registered provider, so the bare id
 * would be ambiguous the moment a second adapter mounts, and `/model` has
 * always taken the qualified form. Enter submits `/model <provider>/<id>`
 * through the ordinary dispatch.
 *
 * No `llm` service mounted, no selection, or a failed listing means no rows,
 * which means no picker — the same dark-feature stance as the other two.
 * @module @qiao-qyn/dsh-tui/pickers/model-picker
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
 * Map advertised models from every registered provider into picker rows.
 *
 * The row's **name is the route-qualified `provider/id`** — that is the form
 * `/model` has always accepted, and the only form that survives a second
 * adapter mounting a model with the same bare id. The description is the
 * provider's display name and the model's own name, so a row reads as one
 * phrase the user can say out loud; the model the session is currently on
 * carries {@link CURRENT_MODEL_GLYPH} so the list answers "what am I on"
 * before it answers "what can I pick".
 * @param models - every provider's catalogue, concatenated in provider order.
 * @param current - the exact route the session is on, if selection is known.
 * @param providerName - display name per provider route, from `listProviders`.
 * @returns one row per advertised model, input order preserved.
 */
export function modelRows(
  models: readonly LlmModelInfo[],
  current: { provider: string; model: string } | undefined,
  providerName: (provider: string) => string,
): CommandMeta[] {
  return models.map((model) => {
    const label = `${model.name} · ${providerName(model.provider)}`
    return {
      name: `${model.provider}/${model.id}`,
      description: current !== undefined
        && current.provider === model.provider
        && current.model === model.id
        ? `${CURRENT_MODEL_GLYPH} ${label}`
        : label,
    }
  })
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
 * @param qualified - a row's `provider/id` name.
 * @returns the full command line, e.g. `/model deepseek-official/deepseek-v4`.
 */
export function modelCommandLine(qualified: string): string {
  return `/model ${qualified}`
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
 * Case-insensitive **prefix** match on either half of the `provider/id` name:
 * a user typing `v4` means the model, and one typing `deep` means the
 * provider; requiring the qualified prefix would make every provider name a
 * keystroke tax. Rows arrive in catalogue order and leave in it; the floating
 * palette does the windowing.
 * @param rows - the candidate rows, named by `provider/id`.
 * @param query - the token typed after `/model `.
 * @returns the matching rows, input order preserved.
 */
export function filterModelRows(rows: readonly CommandMeta[], query: string): CommandMeta[] {
  const wanted = query.toLowerCase()
  return rows.filter((row) => {
    if (row.name.toLowerCase().startsWith(wanted)) return true
    const slash = row.name.indexOf('/')
    return slash >= 0 && row.name.slice(slash + 1).toLowerCase().startsWith(wanted)
  })
}
