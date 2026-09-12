/**
 * The built-in catalog of common MCP servers `/mcp add ` offers.
 *
 * Every entry is a *preset*: a server whose row this package can write without
 * being told anything — no path to authorize, no connection string, and above
 * all no credential. That last limit is mechanical, not cautious: the patch
 * writer emits plain YAML scalars, and a quoted `'!!js …'` string round-trips
 * as a literal, not as the expression tag the loader evaluates. So a preset
 * that needed a key would write a broken row, and a preset that wrote the key
 * itself would write it in plaintext — the exact thing `secretEnvKeys` warns
 * about for pastes. Presets are the zero-decision path; anything that needs a
 * credential or an argument stays on the paste path.
 *
 * The commands are all `npx`, because a machine running this TUI is by
 * definition running Node ≥ 22, so `npx` is the one launcher that is always
 * there. Package names and versions were verified against the registry when
 * the catalog was written; a stale entry fails to start and `/mcp` reports it
 * as absent, which is the honest degradation.
 *
 * Pure data plus one lookup: no disk, no i18n (descriptions are catalog keys,
 * translated in `i18n.ts` per rule 11), no React.
 * @module @qiao-qyn/dsh-tui/mcp/mcp-catalog
 */

import { type McpPatchRow, MCP_PLUGIN_NAME, SERVER_NAME_PATTERN, rowIdFor } from './mcp-config.ts'

/**
 * Every preset's {@link McpPreset.descriptionKey}. Spelled as a union rather
 * than derived so `i18n.ts` can type its description records against it: a
 * preset added without a description in both languages does not compile
 * (rule 11), and `tests/mcp-catalog.spec.ts` pins that the union covers
 * exactly the catalog.
 */
export type McpPresetKey =
  | 'memory'
  | 'sequential-thinking'
  | 'context7'
  | 'playwright'
  | 'everything'

/** One preset's identity and the row it writes. */
export interface McpPreset {
  /** The `serverName` the bridge namespaces under; also the picker's row name. */
  name: string
  /** Key into the i18n catalog's preset descriptions; never shown raw. */
  descriptionKey: McpPresetKey
  /** The stdio command, e.g. `npx`. */
  command: string
  /** Arguments to the command, package spec first. */
  args: readonly string[]
}

/** The catalog, in picker order: memory, reasoning, docs, browser, demo. */
export const MCP_PRESETS: readonly McpPreset[] = [
  {
    name: 'memory',
    descriptionKey: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
  },
  {
    name: 'sequential-thinking',
    descriptionKey: 'sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    name: 'context7',
    descriptionKey: 'context7',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
  },
  {
    name: 'playwright',
    descriptionKey: 'playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
  },
  {
    name: 'everything',
    descriptionKey: 'everything',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  },
] as const

/**
 * Find a preset by the single word `/mcp add` was given.
 *
 * Exact match only, case-sensitive: the picker writes the name verbatim, and
 * silently resolving `Memory` would mean two spellings own one namespace.
 * @param token - the payload after `/mcp add`, already trimmed.
 * @returns the preset, or `undefined` when the token names none.
 */
export function findPreset(token: string): McpPreset | undefined {
  return MCP_PRESETS.find(preset => preset.name === token)
}

/**
 * The loader row a preset writes.
 *
 * Built through the same `McpPatchRow` shape `parseMcpSnippet` returns, so
 * `addMcpRows` cannot tell a preset from a paste — the dedupe, the one-patch-
 * per-server layout, and the connect-wait all apply identically.
 * @param preset - the catalog entry.
 * @returns the row to append to the patch layer.
 */
export function presetRow(preset: McpPreset): McpPatchRow {
  return {
    id: rowIdFor(preset.name),
    name: MCP_PLUGIN_NAME,
    config: {
      transport: 'stdio',
      serverName: preset.name,
      command: preset.command,
      args: [...preset.args],
    },
  }
}

// The catalog's own invariants, checked at module load rather than only in a
// spec: a name the bridge would refuse, or a duplicate namespace, is a bug in
// this file and nothing downstream can say so louder than a boot failure here.
for (const preset of MCP_PRESETS) {
  if (!SERVER_NAME_PATTERN.test(preset.name)) {
    throw new Error(`mcp preset name rejected by the bridge's pattern: ${preset.name}`)
  }
}
if (new Set(MCP_PRESETS.map(preset => preset.name)).size !== MCP_PRESETS.length) {
  throw new Error('mcp preset catalog lists a serverName twice')
}
