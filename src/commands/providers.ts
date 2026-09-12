/**
 * What `/provider` knows: which LLM provider routes the assembly registers,
 * and which one the session is on.
 *
 * The mirror of `mcp.ts` for the model side: the `llm` service's adapter
 * registry is the only authority on what is mounted, read fresh on every
 * call. The command is deliberately **read-only** — configuring a provider
 * means a base URL and a credential, and a credential must never pass through
 * a chat line (rule 4), so the transcript's answer points at the file the
 * user edits instead of a prompt that would take the key through the buffer.
 *
 * The rows are described here rather than in the command so the ordering and
 * the marking can be tested by calling them (SPEC §3.4).
 * @module @qiao-qyn/dsh-tui/commands/providers
 */

/** One registered provider route, as `/provider` reports it. */
export interface ProviderRow {
  /** The route key `/model <provider>/<id>` accepts. */
  id: string
  /** The adapter's display name for the route. */
  name: string
}

/**
 * Mark the row the session's selection is on.
 *
 * The comparison is by route id — a selection names exactly one route, and
 * the row list is in registration order, so the tick lands on one row at
 * most. An unknown selection (no service, or a route that vanished) ticks
 * nothing, which is the honest answer rather than a guess.
 * @param rows - output of `llm.listProviders()`, in registration order.
 * @param current - the selected route id, if a selection exists.
 * @returns the same rows, with the selected one first-named in the caller's
 *   formatting pass (the module stays string-free; the catalog owns wording).
 */
export function selectProviderRow(rows: readonly ProviderRow[], current: string | undefined): number {
  if (current === undefined) return -1
  return rows.findIndex(row => row.id === current)
}

/**
 * Lay the rows out for the transcript.
 *
 * One line per route — its id and display name, the selected one carrying a
 * leading `✓` — under the heading the catalog supplies. The glyph is drawn
 * here rather than chosen per-language because it is the same mark the
 * pickers use for "in force", and that vocabulary is untranslated like the
 * key names.
 * @param rows - the registered routes, in registration order.
 * @param selected - the index {@link selectProviderRow} found, or -1.
 * @param rowLine - the catalog's formatter for one route.
 * @returns the indented block, without a trailing newline.
 */
export function formatProviderRows(
  rows: readonly ProviderRow[],
  selected: number,
  rowLine: (id: string, name: string, current: boolean) => string,
): string {
  return rows.map((row, index) => `  ${rowLine(row.id, row.name, index === selected)}`).join('\n')
}
