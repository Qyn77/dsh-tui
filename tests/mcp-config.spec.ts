/**
 * Reading a pasted MCP server snippet. Pure translation: the shapes a README
 * actually prints go in, loader rows come out, and every refusal is named by
 * its code rather than by the sentence some catalog wraps it in.
 */

import { describe, expect, it } from 'vitest'
import { MCP_PLUGIN_NAME, parseMcpSnippet, rowIdFor, secretEnvKeys } from '../src/mcp-config.ts'

const CLAUDE_DESKTOP = JSON.stringify({
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    },
  },
})

/** Shorthand: every case here parses one snippet. */
const rowsOf = parseMcpSnippet

describe('parseMcpSnippet', () => {
  it('reads the mcpServers document a README prints', () => {
    const result = rowsOf(CLAUDE_DESKTOP)
    expect(result).toEqual({
      kind: 'ok',
      rows: [{
        id: 'mcp-filesystem',
        name: MCP_PLUGIN_NAME,
        config: {
          transport: 'stdio',
          serverName: 'filesystem',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      }],
    })
  })

  it('reads the bare map someone copied out of the middle of one', () => {
    const result = rowsOf('{"engram": {"command": "engram", "args": ["mcp"]}}')
    expect(result.kind).toBe('ok')
    expect(result.kind === 'ok' && result.rows[0]?.config).toEqual({
      transport: 'stdio',
      serverName: 'engram',
      command: 'engram',
      args: ['mcp'],
    })
  })

  it('infers Streamable HTTP from a url, not from a type field', () => {
    const result = rowsOf('{"ctx7": {"type": "sse", "url": "https://mcp.example.com/mcp", "headers": {"X-A": "b"}}}')
    expect(result.kind === 'ok' && result.rows[0]?.config).toEqual({
      transport: 'streamable-http',
      serverName: 'ctx7',
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-A': 'b' },
    })
  })

  it('keeps every server in a multi-server document, in file order', () => {
    const result = rowsOf('{"mcpServers": {"b": {"command": "b"}, "a": {"command": "a"}}}')
    expect(result.kind === 'ok' && result.rows.map(row => row.id)).toEqual(['mcp-b', 'mcp-a'])
  })

  it('survives the code fence a browser selection drags along', () => {
    const fenced = ['```json', CLAUDE_DESKTOP, '```'].join('\n')
    expect(rowsOf(fenced).kind).toBe('ok')
  })

  it('carries env and cwd through, and omits what was not given', () => {
    const result = rowsOf('{"s": {"command": "run", "env": {"A": "1"}, "cwd": "/w"}}')
    expect(result.kind === 'ok' && result.rows[0]?.config).toEqual({
      transport: 'stdio',
      serverName: 's',
      command: 'run',
      env: { A: '1' },
      cwd: '/w',
    })
  })

  it('names the JSON error rather than swallowing it', () => {
    const result = rowsOf('{"s": {"command": "x",}}')
    expect(result.kind === 'error' && result.error.code).toBe('json')
  })

  it('refuses a snippet copied one level too deep, and says which level', () => {
    const result = rowsOf('{"command": "npx", "args": ["-y", "thing"]}')
    expect(result.kind === 'error' && result.error).toEqual({ code: 'missing-name' })
  })

  it('refuses a server name the bridge would reject', () => {
    const result = rowsOf('{"my server": {"command": "x"}}')
    expect(result.kind === 'error' && result.error).toEqual({ code: 'bad-name', server: 'my server' })
  })

  it('refuses an entry that declares neither transport', () => {
    const result = rowsOf('{"s": {"description": "does things"}}')
    expect(result.kind === 'error' && result.error).toEqual({ code: 'unknown-transport', server: 's' })
  })

  it('names the malformed field, not just the server', () => {
    expect(rowsOf('{"s": {"command": "x", "args": "-y"}}')).toEqual({
      kind: 'error',
      error: { code: 'bad-field', server: 's', field: 'args' },
    })
    expect(rowsOf('{"s": {"command": "x", "env": {"A": 1}}}')).toEqual({
      kind: 'error',
      error: { code: 'bad-field', server: 's', field: 'env' },
    })
  })

  it('refuses an entry that is not an object at all', () => {
    expect(rowsOf('{"s": "npx thing"}')).toEqual({
      kind: 'error',
      error: { code: 'entry-not-object', server: 's' },
    })
  })

  it('refuses nothing, an array, and an empty map, each in its own way', () => {
    expect(rowsOf('   ')).toEqual({ kind: 'error', error: { code: 'empty' } })
    expect(rowsOf('[]')).toEqual({ kind: 'error', error: { code: 'not-object' } })
    expect(rowsOf('{}')).toEqual({ kind: 'error', error: { code: 'empty' } })
    expect(rowsOf('{"mcpServers": {}}')).toEqual({ kind: 'error', error: { code: 'empty' } })
  })
})

describe('rowIdFor', () => {
  it('derives the id from the name, so removal needs no lookup table', () => {
    expect(rowIdFor('filesystem')).toBe('mcp-filesystem')
  })
})

describe('secretEnvKeys', () => {
  it('flags a literal that looks like a credential', () => {
    const config = {
      transport: 'stdio' as const,
      serverName: 's',
      command: 'x',
      env: { GITHUB_TOKEN: 'ghp_literal', HOME: '/root', API_KEY: 'sk-literal' },
    }
    expect(secretEnvKeys(config)).toEqual(['GITHUB_TOKEN', 'API_KEY'])
  })

  it('leaves a reference and an empty value alone — neither holds the secret', () => {
    const config = {
      transport: 'stdio' as const,
      serverName: 's',
      command: 'x',
      env: { A_TOKEN: '${GITHUB_TOKEN}', B_KEY: '!!js process.env.B', C_SECRET: '  ' },
    }
    expect(secretEnvKeys(config)).toEqual([])
  })

  it('reads an HTTP server\'s headers, where its credentials live', () => {
    const config = {
      transport: 'streamable-http' as const,
      serverName: 's',
      url: 'https://x/mcp',
      headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'literal' },
    }
    expect(secretEnvKeys(config)).toEqual(['Authorization', 'X-Api-Key'])
  })

  it('reports nothing when the server declares no environment', () => {
    expect(secretEnvKeys({ transport: 'stdio', serverName: 's', command: 'x' })).toEqual([])
  })
})
