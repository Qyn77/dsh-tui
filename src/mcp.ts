/**
 * What `/mcp` knows: which MCP servers are connected, and which of their
 * tools the model can call.
 *
 * The MCP client bridge (`@deepseek-ai/dsh-mcp-client`) registers every tool
 * it discovers on `ctx.tools` under the server-qualified name
 * `mcp__<serverName>__<rawName>` — the same shape Claude Code and Codex use —
 * and that registry is the only authority on what is connected. It is read
 * fresh on every call; a server that reconnects and re-syncs between two
 * `/mcp` invocations is simply two different answers, not a cache bug.
 *
 * The rows are described here rather than in the command so the grouping and
 * the ordering can be tested by calling them (SPEC §3.4).
 * @module @deepseek-ai/dsh-tui/mcp
 */

/**
 * One connected MCP server, as `/mcp` reports it.
 */
export interface McpServerRow {
  /** The `serverName` namespace the plugin instance was configured with. */
  name: string
  /** The servers' raw tool names, in the registry's registration order. */
  tools: readonly string[]
}

/**
 * As much of a tool schema as this module reads.
 *
 * Structural, not imported: `ToolSchema` drags in the whole LLM request
 * shape, and a test would then have to build one to say anything about
 * grouping. Only the name is used, and a real schema satisfies this.
 */
export interface McpToolLike {
  name: string
}

/**
 * Group visible tools into one row per MCP server.
 *
 * The public name is `mcp__<serverName>__<rawName>`, and both halves are
 * restricted to `[A-Za-z0-9_-]` by the bridge's normalizer — so neither half
 * can contain the `__` separator this parser splits on, and taking the
 * *first* separator after the prefix is unambiguous. Tools that are not
 * MCP-sourced (every built-in: bash, fs, …) have no `mcp__` prefix and are
 * skipped; a non-MCP tool that somehow spelled its name into the shape would
 * be listed too, which is the honest reading of the registry.
 *
 * Order is the registry's registration order, first appearance of each
 * server — the order the user's config lists the plugins in, so the list
 * matches their mental model of what they wired up.
 * @param schemas - the visible tools, from `ctx.tools.schemas()`.
 * @returns one row per server, in first-appearance order.
 */
export function describeMcpServers(schemas: readonly McpToolLike[]): McpServerRow[] {
  const byServer = new Map<string, string[]>()
  for (const { name } of schemas) {
    if (!name.startsWith('mcp__')) continue
    const rest = name.slice('mcp__'.length)
    const separator = rest.indexOf('__')
    if (separator <= 0) continue
    const server = rest.slice(0, separator)
    const raw = rest.slice(separator + '__'.length)
    const bucket = byServer.get(server)
    if (bucket === undefined) byServer.set(server, [raw])
    else bucket.push(raw)
  }
  return [...byServer.entries()].map(([name, tools]) => ({ name, tools }))
}

/**
 * Lay the rows out for the transcript.
 *
 * One header line per server — the catalog's `mcpServer(name, count)` wording
 * — with the tool names indented under it, so a wide server reads as a list
 * rather than one long line the message list would have to truncate.
 * @param rows - output of {@link describeMcpServers}.
 * @param serverLine - the catalog's `mcpServer` string for a header.
 * @returns the indented block, without a trailing newline.
 */
export function formatMcpServers(
  rows: readonly McpServerRow[],
  serverLine: (name: string, count: number) => string,
): string {
  return rows
    .map(row => [`  ${serverLine(row.name, row.tools.length)}`, ...row.tools.map(tool => `    ${tool}`)].join('\n'))
    .join('\n')
}
