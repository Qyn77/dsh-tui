/**
 * Translating a pasted MCP server snippet into the row a patch layer holds.
 *
 * Every MCP server in the wild documents itself as the same block of JSON —
 * the `mcpServers` map Claude Desktop, Cursor and the rest read. That block is
 * what a user has in their clipboard, so it is what `/mcp add` accepts, and
 * this module is the whole translation from it to the
 * `@deepseek-ai/dsh-mcp-client` entry the loader understands. Nothing here
 * touches the disk or the loader: a translation that can be tested by calling
 * it is a translation whose refusals can be tested too (SPEC §3.4).
 *
 * Refusals are returned as codes rather than sentences. The catalog turns them
 * into both languages, and a test can assert *which* refusal happened without
 * pinning the wording (rule 11).
 * @module @deepseek-ai/dsh-tui/mcp/mcp-config
 */

/** The plugin every added row mounts. */
export const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client'

/**
 * What the bridge accepts as a `serverName`.
 *
 * Restated rather than imported: the bridge is an optional peer this package
 * does not depend on, and the pattern is part of the contract `/mcp add`
 * checks *before* writing, so the refusal reads as a typo rather than as a
 * plugin that failed to start ten seconds later.
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * The row id a server's entry is written under.
 *
 * Derived from the name rather than random so `/mcp remove` can find the row
 * without a lookup table, and so a user reading their patch file sees which
 * row is which.
 * @param serverName - the validated server name.
 * @returns the loader row id.
 */
export function rowIdFor(serverName: string): string {
  return `mcp-${serverName}`
}

/** A server the bridge talks to over a child process' stdio. */
export interface McpStdioConfig {
  transport: 'stdio'
  serverName: string
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

/** A server the bridge talks to over Streamable HTTP. */
export interface McpHttpConfig {
  transport: 'streamable-http'
  serverName: string
  url: string
  headers?: Record<string, string>
}

/** One server's configuration, in either transport. */
export type McpServerConfig = McpStdioConfig | McpHttpConfig

/** One loader row: what gets inserted into the patch layer. */
export interface McpPatchRow {
  id: string
  name: string
  config: McpServerConfig
}

/**
 * Why a paste was refused.
 *
 * One code per thing that can be wrong with a snippet, each carrying only what
 * the message needs to name the offending part.
 */
export type McpParseError =
  | { code: 'json'; detail: string }
  | { code: 'not-object' }
  | { code: 'empty' }
  | { code: 'missing-name' }
  | { code: 'entry-not-object'; server: string }
  | { code: 'bad-name'; server: string }
  | { code: 'unknown-transport'; server: string }
  | { code: 'bad-field'; server: string; field: string }

/** Either the rows a snippet describes, or the first reason it was refused. */
export type McpParseResult =
  | { kind: 'ok'; rows: McpPatchRow[] }
  | { kind: 'error'; error: McpParseError }

/**
 * Parse a pasted snippet into loader rows.
 *
 * Accepts the two shapes a README actually prints: the full
 * `{"mcpServers": {…}}` document, and the bare `{"name": {…}}` map someone
 * copied out of the middle of one. A fenced block survives too, because
 * selecting a fenced snippet in a browser usually takes the fences with it.
 *
 * Refuses on the first problem rather than collecting them: the snippet is
 * one paste, and a user who mistyped a field will re-paste, not repair five
 * complaints in a row.
 * @param text - the pasted snippet, fences and surrounding space included.
 * @returns the rows, or the refusal.
 */
export function parseMcpSnippet(text: string): McpParseResult {
  const source = stripFences(text).trim()
  if (source === '') return { kind: 'error', error: { code: 'empty' } }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { kind: 'error', error: { code: 'json', detail } }
  }
  if (!isRecord(parsed)) return { kind: 'error', error: { code: 'not-object' } }

  // `mcpServers` is a wrapper, never a server: no server may be named that,
  // because the wrapper would be indistinguishable from it.
  const nested = parsed['mcpServers']
  const servers = isRecord(nested) ? nested : parsed
  const names = Object.keys(servers)
  if (names.length === 0) return { kind: 'error', error: { code: 'empty' } }
  // A snippet copied from one level too deep: the config itself, with no name
  // wrapping it. Worth its own message — "filesystem is not an object" would
  // send the user looking in the wrong place.
  if (servers['command'] !== undefined || servers['url'] !== undefined) {
    return { kind: 'error', error: { code: 'missing-name' } }
  }

  const rows: McpPatchRow[] = []
  for (const serverName of names) {
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      return { kind: 'error', error: { code: 'bad-name', server: serverName } }
    }
    const entry = servers[serverName]
    if (!isRecord(entry)) {
      return { kind: 'error', error: { code: 'entry-not-object', server: serverName } }
    }
    const config = readServer(serverName, entry)
    if ('code' in config) return { kind: 'error', error: config }
    rows.push({ id: rowIdFor(serverName), name: MCP_PLUGIN_NAME, config })
  }
  return { kind: 'ok', rows }
}

/**
 * Read one server entry into a config, or the reason it could not be.
 *
 * The transport is inferred from which of `command`/`url` is present rather
 * than from a `type` field, because the `type` spelling varies across the
 * clients that publish these snippets (`http`, `streamable-http`, `sse`,
 * absent) while the two fields do not.
 * @param serverName - the validated name, for the refusal messages.
 * @param entry - the object under that name.
 * @returns the config, or a parse error.
 */
function readServer(serverName: string, entry: Record<string, unknown>): McpServerConfig | McpParseError {
  const bad = (field: string): McpParseError => ({ code: 'bad-field', server: serverName, field })
  if (typeof entry['command'] === 'string') {
    const command = entry['command']
    if (command.trim() === '') return bad('command')
    const config: McpStdioConfig = { transport: 'stdio', serverName, command }
    const args = entry['args']
    if (args !== undefined) {
      if (!Array.isArray(args) || args.some(item => typeof item !== 'string')) return bad('args')
      config.args = args as string[]
    }
    const env = readStringDict(entry['env'])
    if (env === 'invalid') return bad('env')
    if (env !== undefined) config.env = env
    const cwd = entry['cwd']
    if (cwd !== undefined) {
      if (typeof cwd !== 'string') return bad('cwd')
      config.cwd = cwd
    }
    return config
  }
  if (typeof entry['url'] === 'string') {
    const url = entry['url']
    if (url.trim() === '') return bad('url')
    const config: McpHttpConfig = { transport: 'streamable-http', serverName, url }
    const headers = readStringDict(entry['headers'])
    if (headers === 'invalid') return bad('headers')
    if (headers !== undefined) config.headers = headers
    return config
  }
  return { code: 'unknown-transport', server: serverName }
}

/**
 * Read an optional `Record<string, string>` field.
 * @param value - the raw field.
 * @returns the dict, `undefined` when absent, or `'invalid'` when malformed.
 */
function readStringDict(value: unknown): Record<string, string> | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (!isRecord(value)) return 'invalid'
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return 'invalid'
    out[key] = item
  }
  return out
}

/** Environment variable names whose values are worth warning about. */
const SECRET_KEY_PATTERN = /key|token|secret|password|passwd|credential|auth/i

/**
 * Which of a row's environment variables look like secrets.
 *
 * The bridge resolves no credential references — its `env` is a plain string
 * dict interpolated at config time — so a key pasted into a snippet lands in
 * the patch file as plaintext. That is a real choice a user may want to make,
 * and it is not one they should make without being told, so `/mcp add` says
 * so rather than refusing.
 *
 * A value that is a `${…}` or `!!js` reference resolves elsewhere and is not
 * flagged; an empty value holds nothing to leak.
 * @param config - the parsed server config.
 * @returns the flagged variable names, in declaration order.
 */
export function secretEnvKeys(config: McpServerConfig): string[] {
  const env = config.transport === 'stdio' ? config.env : config.headers
  if (env === undefined) return []
  return Object.entries(env)
    .filter(([key, value]) => {
      if (!SECRET_KEY_PATTERN.test(key)) return false
      const trimmed = value.trim()
      return trimmed !== '' && !trimmed.startsWith('${') && !trimmed.startsWith('!!js')
    })
    .map(([key]) => key)
}

/**
 * Drop a Markdown code fence wrapping the snippet.
 *
 * Only an exact wrapper is removed — a leading ```` ```lang ```` line and a
 * trailing ```` ``` ```` line. Anything else is left for `JSON.parse` to
 * complain about, which is the honest reading of a paste this module cannot
 * recognise.
 * @param text - the pasted text.
 * @returns the text without its fences.
 */
function stripFences(text: string): string {
  const lines = text.trim().split('\n')
  const first = lines[0]?.trim() ?? ''
  const last = lines[lines.length - 1]?.trim() ?? ''
  if (lines.length >= 2 && first.startsWith('```') && last === '```') {
    return lines.slice(1, -1).join('\n')
  }
  return text
}

/**
 * Whether a parsed JSON value is a plain object.
 * @param value - the value to test.
 * @returns true for objects that are not arrays or null.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
