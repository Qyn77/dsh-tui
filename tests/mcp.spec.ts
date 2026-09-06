/**
 * The `/mcp` row model: grouping the tool registry's `mcp__`-prefixed names
 * into per-server rows, and laying those rows out for the transcript. Pure
 * functions over plain objects, per SPEC §3.4 — the command is left with the
 * one call that has an effect (reading `ctx.tools`).
 */

import { describe, expect, it } from 'vitest'
import { describeMcpServers, formatMcpServers, type McpToolLike } from '../src/mcp.ts'

const tools = (...names: string[]): McpToolLike[] => names.map(name => ({ name }))

describe('describeMcpServers', () => {
  it('groups mcp__ tools by server, first appearance ordering both levels', () => {
    const rows = describeMcpServers([
      { name: 'bash' },
      { name: 'mcp__memory__create_entities' },
      { name: 'mcp__github__create_issue' },
      { name: 'mcp__memory__search_nodes' },
      { name: 'fs_read' },
    ])
    expect(rows).toEqual([
      { name: 'memory', tools: ['create_entities', 'search_nodes'] },
      { name: 'github', tools: ['create_issue'] },
    ])
  })

  it('skips names without the mcp__ prefix, single underscores included', () => {
    // `mcp_tools_delete` is a plausible non-MCP name: one underscore is not
    // the separator, and reading it as a server would list a tool that was
    // never registered by the bridge.
    expect(describeMcpServers(tools('bash', 'mcp_tools_delete', 'workflow_start'))).toEqual([])
  })

  it('keeps server names that merely contain an underscore', () => {
    // The bridge allows `_` inside `serverName`; only the double underscore
    // separates the halves, and the first one after the prefix is it.
    const rows = describeMcpServers(tools('mcp__my_server__search_all'))
    expect(rows).toEqual([{ name: 'my_server', tools: ['search_all'] }])
  })

  it('returns an empty table for an empty registry', () => {
    expect(describeMcpServers([])).toEqual([])
  })
})

describe('formatMcpServers', () => {
  const serverLine = (name: string, count: number): string => `${name}: ${count}`

  it('indents each server header with its tools beneath it', () => {
    const text = formatMcpServers(
      [{ name: 'github', tools: ['create_issue', 'search'] }, { name: 'memory', tools: ['read'] }],
      serverLine,
    )
    expect(text).toBe([
      '  github: 2',
      '    create_issue',
      '    search',
      '  memory: 1',
      '    read',
    ].join('\n'))
  })

  it('renders a server with no tools as a bare header', () => {
    // Not a shape the bridge produces (a generation is all-or-nothing), but
    // the formatter is structural and must not assume the grouping's output.
    expect(formatMcpServers([{ name: 'ghost', tools: [] }], serverLine)).toBe('  ghost: 0')
  })
})
