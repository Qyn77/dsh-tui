/**
 * Rewriting the user's patch layer. The file belongs to them: these cases are
 * mostly about what survives a write — their comments, their `!!js`
 * expressions, their hand-written rows — because a `/mcp add` that quietly
 * reformats a config file is a data-loss bug wearing a success message.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MCP_PLUGIN_NAME, type McpPatchRow } from '../src/mcp-config.ts'
import { addMcpRows, dshHome, listPatchedServers, patchPath, PATCH_FILE, removeMcpRow } from '../src/mcp-patch.ts'

const home = (): string => mkdtempSync(join(tmpdir(), 'dsh-tui-mcp-'))

const file = (dir: string): string => join(dir, PATCH_FILE)

function row(serverName: string, command = 'npx'): McpPatchRow {
  return {
    id: `mcp-${serverName}`,
    name: MCP_PLUGIN_NAME,
    config: { transport: 'stdio', serverName, command },
  }
}

const HAND_WRITTEN = `# my own layer, do not eat my comments
- insert:
    - id: memory-engram
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: engram
        transport: stdio
        command: engram
        args: [mcp]
        cwd: !!js process.cwd()
`

describe('patchPath', () => {
  afterEach(() => {
    delete process.env.DSH_HOME
  })

  it('follows $DSH_HOME the way the harness does', () => {
    process.env.DSH_HOME = '/somewhere/else'
    expect(patchPath()).toBe(join('/somewhere/else', PATCH_FILE))
  })

  it('treats a blank override as unset rather than as the working directory', () => {
    process.env.DSH_HOME = '   '
    expect(dshHome({ DSH_HOME: '   ' }, '/users/x')).toBe(join('/users/x', '.dsh'))
  })

  it('falls back to ~/.dsh', () => {
    expect(dshHome({}, '/users/x')).toBe(join('/users/x', '.dsh'))
  })
})

describe('addMcpRows', () => {
  it('creates the layer, with a header saying what it is', () => {
    const dir = home()
    expect(addMcpRows([row('filesystem')], file(dir))).toEqual({ kind: 'written', servers: ['filesystem'] })
    const text = readFileSync(file(dir), 'utf8')
    expect(text).toContain('/mcp add')
    expect(text).toContain('id: mcp-filesystem')
    expect(text).toContain("name: '@deepseek-ai/dsh-mcp-client'")
  })

  it('preserves comments and !!js expressions already in the file', () => {
    const dir = home()
    writeFileSync(file(dir), HAND_WRITTEN)
    expect(addMcpRows([row('filesystem')], file(dir)).kind).toBe('written')
    const text = readFileSync(file(dir), 'utf8')
    expect(text).toContain('# my own layer, do not eat my comments')
    expect(text).toContain('cwd: !!js process.cwd()')
    expect(text).toContain('args: [mcp]')
    expect(text).toContain('id: mcp-filesystem')
  })

  it('appends one patch per server, so removal never rewrites a shared list', () => {
    const dir = home()
    addMcpRows([row('a'), row('b')], file(dir))
    const text = readFileSync(file(dir), 'utf8')
    expect(text.match(/- insert:/g)).toHaveLength(2)
  })

  it('turns an empty layer into block YAML rather than one flow line', () => {
    const dir = home()
    writeFileSync(file(dir), '[]\n')
    addMcpRows([row('a')], file(dir))
    expect(readFileSync(file(dir), 'utf8')).toContain('- insert:')
  })

  it('refuses a server the layer already carries, however it got there', () => {
    const dir = home()
    writeFileSync(file(dir), HAND_WRITTEN)
    expect(addMcpRows([row('engram')], file(dir))).toEqual({ kind: 'duplicate', server: 'engram' })
    expect(readFileSync(file(dir), 'utf8')).toBe(HAND_WRITTEN)
  })

  it('writes nothing at all when one server of several is a duplicate', () => {
    const dir = home()
    addMcpRows([row('a')], file(dir))
    const before = readFileSync(file(dir), 'utf8')
    expect(addMcpRows([row('b'), row('a')], file(dir)).kind).toBe('duplicate')
    expect(readFileSync(file(dir), 'utf8')).toBe(before)
  })

  it('refuses to touch a layer it cannot parse', () => {
    const dir = home()
    writeFileSync(file(dir), 'invalid: [unclosed\n')
    const result = addMcpRows([row('a')], file(dir))
    expect(result.kind).toBe('failed')
    expect(readFileSync(file(dir), 'utf8')).toBe('invalid: [unclosed\n')
  })

  it('refuses a layer that is not the top-level list a patch layer must be', () => {
    const dir = home()
    writeFileSync(file(dir), 'insert: {}\n')
    expect(addMcpRows([row('a')], file(dir)).kind).toBe('failed')
  })

  it('reports a write it could not make instead of throwing', () => {
    const dir = home()
    // The path is a directory: opening it for writing fails, and the command
    // has to be able to say so.
    mkdirSync(join(dir, 'blocked'))
    expect(addMcpRows([row('a')], join(dir, 'blocked')).kind).toBe('failed')
  })
})

describe('removeMcpRow', () => {
  it('takes the row and its now-empty patch out, leaving the rest alone', () => {
    const dir = home()
    writeFileSync(file(dir), HAND_WRITTEN)
    addMcpRows([row('filesystem')], file(dir))
    expect(removeMcpRow('filesystem', file(dir))).toEqual({ kind: 'written', servers: ['filesystem'] })
    const text = readFileSync(file(dir), 'utf8')
    expect(text).not.toContain('mcp-filesystem')
    expect(text).toContain('cwd: !!js process.cwd()')
    expect(text).toContain('# my own layer, do not eat my comments')
    expect(text.match(/- insert:/g)).toHaveLength(1)
  })

  it('addresses a hand-written row by its server name, not by our id scheme', () => {
    const dir = home()
    writeFileSync(file(dir), HAND_WRITTEN)
    expect(removeMcpRow('engram', file(dir))).toEqual({ kind: 'written', servers: ['engram'] })
    const text = readFileSync(file(dir), 'utf8')
    expect(text).not.toContain('memory-engram')
    expect(text).toContain('# my own layer, do not eat my comments')
  })

  it('reports a server the layer does not configure, and writes nothing', () => {
    const dir = home()
    writeFileSync(file(dir), HAND_WRITTEN)
    expect(removeMcpRow('nope', file(dir))).toEqual({ kind: 'missing', server: 'nope' })
    expect(readFileSync(file(dir), 'utf8')).toBe(HAND_WRITTEN)
  })

  it('reports missing when there is no layer at all', () => {
    expect(removeMcpRow('nope', file(home())).kind).toBe('missing')
  })
})

describe('listPatchedServers', () => {
  it('names the servers the layer configures, hand-written ones included', () => {
    const dir = home()
    writeFileSync(file(dir), HAND_WRITTEN)
    addMcpRows([row('filesystem')], file(dir))
    expect(listPatchedServers(file(dir))).toEqual(['engram', 'filesystem'])
  })

  it('is empty for an absent or unreadable layer rather than throwing', () => {
    expect(listPatchedServers(file(home()))).toEqual([])
  })
})
