/**
 * The `/mcp` row model: grouping the tool registry's `mcp__`-prefixed names
 * into per-server rows, and laying those rows out for the transcript. Pure
 * functions over plain objects, per SPEC §3.4 — the command is left with the
 * one call that has an effect (reading `ctx.tools`).
 */

import { describe, expect, it, vi } from 'vitest'
import { describeMcpServers, formatMcpServers, waitForMcpServer, type McpToolLike } from '../src/mcp/mcp.ts'

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

describe('waitForMcpServer', () => {
  /** A registry the test fills, with the listeners currently attached to it. */
  function registry(): {
    read: () => McpToolLike[]
    subscribe: (listener: () => void) => () => void
    connect: (server: string, count: number) => void
    listeners: number
  } {
    const names: string[] = []
    const listeners = new Set<() => void>()
    return {
      read: () => tools(...names),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      connect: (server, count) => {
        for (let index = 0; index < count; index += 1) names.push(`mcp__${server}__t${index}`)
        for (const listener of [...listeners]) listener()
      },
      get listeners() { return listeners.size },
    }
  }

  it('answers from the registry without subscribing when the server is already up', async () => {
    const reg = registry()
    reg.connect('fs', 2)
    await expect(waitForMcpServer('fs', reg.read, reg.subscribe, 1000)).resolves.toBe(2)
    expect(reg.listeners).toBe(0)
  })

  it('resolves on the change that brings the server in, and unsubscribes', async () => {
    const reg = registry()
    const pending = waitForMcpServer('fs', reg.read, reg.subscribe, 1000)
    expect(reg.listeners).toBe(1)
    reg.connect('other', 1)
    expect(reg.listeners).toBe(1)
    reg.connect('fs', 3)
    await expect(pending).resolves.toBe(3)
    expect(reg.listeners).toBe(0)
  })

  it('gives up at the deadline and leaves no listener behind', async () => {
    vi.useFakeTimers()
    try {
      const reg = registry()
      const pending = waitForMcpServer('fs', reg.read, reg.subscribe, 500)
      await vi.advanceTimersByTimeAsync(501)
      await expect(pending).resolves.toBeUndefined()
      expect(reg.listeners).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
