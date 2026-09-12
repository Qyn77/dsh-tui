/**
 * The `/mcp add ` picker: preset rows, the anchored query token, and the two
 * ways a choice leaves the list.
 *
 * The fourth command-anchored picker after `/skill `, `/permission ` and
 * `/model `, and the first anchored on a *two-word* prefix: `/mcp add` takes a
 * payload, so the picker anchors on `/mcp add ` and its rows fill the payload
 * slot. A row's name is the bare preset word — that is what `/mcp add` reads
 * back as a catalog lookup — and Enter submits `/mcp add <name>` through the
 * ordinary dispatch, so the write, the connect-wait, and the duplicate check
 * all run the same code a typed line takes.
 *
 * Unlike the other three, this catalog is not discovered at runtime: it is the
 * static list in `mcp-catalog.ts`, so the rows always exist and the picker
 * always opens. That is deliberate — there is no service whose absence should
 * darken it.
 * @module @qiao-qyn/dsh-tui/pickers/mcp-picker
 */

import type { CommandMeta } from '../commands/commands.ts'
import { MCP_PRESETS, type McpPreset } from '../mcp/mcp-catalog.ts'
import { anchoredTokenAt } from '../prompt/prompt-editing.ts'

/** The literal prefix the picker anchors on; {@link McpMention.start} is its length. */
export const MCP_ADD_PREFIX = '/mcp add '

/** A `/mcp add <token>` query in the buffer: what it asks for, and what it occupies. */
export interface McpMention {
  /** The token typed after `/mcp add `, which may be empty right after the space. */
  query: string
  /** Index the query token starts at — the position after `/mcp add `. */
  start: number
  /** Index one past the token's last character. */
  end: number
}

/**
 * Map the preset catalog into picker rows.
 *
 * The row's name is the bare preset word, because that is what the dispatch
 * looks up; the description is resolved through the caller's catalog so the
 * rows are localized without this module importing i18n (rule 11).
 * @param describe - the i18n catalog's preset-description lookup.
 * @returns one row per preset, in catalog order.
 */
export function mcpPresetRows(describe: (preset: McpPreset) => string): CommandMeta[] {
  return MCP_PRESETS.map(preset => ({
    name: preset.name,
    description: describe(preset),
  }))
}

/**
 * Find the `/mcp add ` query token the caret is in, if any.
 *
 * The grammar is the shared command-anchored one (`anchoredTokenAt`): a
 * second token closes the picker, which is what lets a pasted
 * `{"mcpServers": …}` block — many whitespace-separated tokens — fall through
 * to the paste path untouched.
 * @param buffer - the prompt buffer.
 * @param cursor - the caret's index into it.
 * @returns the query token, or `undefined` when the caret is not in one.
 */
export function mcpMentionAt(buffer: string, cursor: number): McpMention | undefined {
  return anchoredTokenAt(buffer, cursor, MCP_ADD_PREFIX)
}

/**
 * The line choosing a preset submits. Enter's answer — the write happens
 * through the ordinary `/mcp add` dispatch, so it keeps its duplicate check,
 * its connect-wait, and its report.
 * @param name - a row's bare preset name.
 * @returns the full command line, e.g. `/mcp add memory`.
 */
export function mcpPresetCommandLine(name: string): string {
  return `${MCP_ADD_PREFIX}${name}`
}

/**
 * Replace the `/mcp add <token>` query with the chosen preset, leaving a
 * space. Tab's answer: the line is completed but not sent, so the choice can
 * be read before Enter writes it.
 * @returns the new buffer and where the caret should sit in it.
 */
export function applyMcpMention(
  buffer: string,
  mention: McpMention,
  name: string,
): { text: string; cursor: number } {
  const head = `${MCP_ADD_PREFIX}${name} `
  return { text: head + buffer.slice(mention.end), cursor: head.length }
}

/**
 * Filter preset rows by the typed token.
 *
 * Case-insensitive **prefix** match on the bare name, same rule the other
 * command pickers use. A token that starts with `{` — the ordinary shape of a
 * paste — matches nothing and closes the list, which is the point: the picker
 * must never claim a paste.
 * @param rows - the candidate rows, named by bare preset name.
 * @param query - the token typed after `/mcp add `.
 * @returns the matching rows, input order preserved.
 */
export function filterMcpPresetRows(
  rows: readonly CommandMeta[],
  query: string,
): CommandMeta[] {
  if (query.startsWith('{')) return []
  const wanted = query.toLowerCase()
  return rows.filter(row => row.name.toLowerCase().startsWith(wanted))
}
