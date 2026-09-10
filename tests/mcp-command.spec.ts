/**
 * The `/mcp add` and `/mcp remove` arms, end to end against a temporary
 * harness home. `$DSH_HOME` is the seam: the command resolves its own path,
 * so pointing the environment at a temp directory exercises the real
 * resolution instead of a path a test handed in.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { dispatch, MCP_CONNECT_TIMEOUT_MS, type CommandContext } from '../src/commands.ts'
import { PATCH_FILE } from '../src/mcp-patch.ts'

const FILESYSTEM = '{"mcpServers":{"filesystem":{"command":"npx","args":["-y","server-fs","/tmp"]}}}'

let home: string

/** A tools service whose registry the test drives. */
interface Registry {
  ctx: Context
  /** Register a server's tools and fire the change the command waits on. */
  connect: (server: string, tools: readonly string[]) => void
}

function makeRegistry(): Registry {
  const ctx = new Context()
  const names: string[] = []
  ctx.provide('tools', { schemas: () => names.map(name => ({ name })) } as never)
  return {
    ctx,
    connect: (server, tools) => {
      names.push(...tools.map(tool => `mcp__${server}__${tool}`))
      ctx.emit('tools/change')
    },
  }
}

function makeCommand(ctx: Context): CommandContext {
  return {
    ctx,
    agent: { id: 'tui-1' as never, session: Session.create(SessionId('tui-test')) } as never,
    resetView: vi.fn(),
    setModel: vi.fn().mockResolvedValue(undefined),
    refreshSelection: vi.fn(),
    state: { entries: [], status: 'idle', currentTurn: 0 },
  }
}

const patchText = (): string => readFileSync(join(home, PATCH_FILE), 'utf8')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-tui-mcp-cmd-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  vi.useRealTimers()
})

describe('/mcp add', () => {
  it('writes the row and reports the tools once the server answers', async () => {
    const registry = makeRegistry()
    const pending = dispatch(`/mcp add ${FILESYSTEM}`, makeCommand(registry.ctx))
    // The row is on disk before the wait begins — that is the durable half,
    // and it does not depend on the server ever answering.
    expect(patchText()).toContain('id: mcp-filesystem')
    registry.connect('filesystem', ['read_file', 'write_file'])
    const result = await pending
    expect(result).toMatchObject({ kind: 'handled' })
    expect(result.kind === 'handled' && result.message).toContain('filesystem')
    expect(result.kind === 'handled' && result.message).toContain('2 tools')
    expect(result.kind === 'handled' && result.message).toContain(join(home, PATCH_FILE))
  })

  it('takes a server that was already up without waiting for an event', async () => {
    const registry = makeRegistry()
    registry.connect('filesystem', ['read_file'])
    const result = await dispatch(`/mcp add ${FILESYSTEM}`, makeCommand(registry.ctx))
    expect(result.kind === 'handled' && result.message).toContain('1 tool')
  })

  it('reports the write when the server does not answer in time', async () => {
    vi.useFakeTimers()
    const registry = makeRegistry()
    const pending = dispatch(`/mcp add ${FILESYSTEM}`, makeCommand(registry.ctx))
    await vi.advanceTimersByTimeAsync(MCP_CONNECT_TIMEOUT_MS + 1)
    const result = await pending
    expect(result).toMatchObject({ kind: 'handled' })
    expect(result.kind === 'handled' && result.failed).toBeUndefined()
    expect(result.kind === 'handled' && result.message).toContain('filesystem')
    expect(patchText()).toContain('id: mcp-filesystem')
  })

  it('takes a multi-line paste, newlines and all', async () => {
    const registry = makeRegistry()
    const pasted = [
      '/mcp add {',
      '  "mcpServers": {',
      '    "filesystem": { "command": "npx", "args": ["-y", "server-fs"] }',
      '  }',
      '}',
    ].join('\n')
    registry.connect('filesystem', ['read_file'])
    const result = await dispatch(pasted, makeCommand(registry.ctx))
    expect(result.kind === 'handled' && result.failed).toBeUndefined()
    expect(patchText()).toContain('id: mcp-filesystem')
  })

  it('warns that a pasted credential landed in the file as plaintext', async () => {
    const registry = makeRegistry()
    registry.connect('gh', ['search'])
    const result = await dispatch(
      '/mcp add {"gh": {"command": "gh-mcp", "env": {"GITHUB_TOKEN": "ghp_literal"}}}',
      makeCommand(registry.ctx),
    )
    expect(result.kind === 'handled' && result.message).toContain('GITHUB_TOKEN')
    // The warning is not a refusal: the row is written either way.
    expect(patchText()).toContain('GITHUB_TOKEN')
  })

  it('prints usage rather than writing when nothing was pasted', async () => {
    const result = await dispatch('/mcp add', makeCommand(makeRegistry().ctx))
    expect(result.kind === 'handled' && result.message).toContain('/mcp add')
    expect(() => patchText()).toThrow()
  })

  it('refuses a snippet it cannot read, and leaves no file behind', async () => {
    const result = await dispatch('/mcp add {"s": {}}', makeCommand(makeRegistry().ctx))
    expect(result).toMatchObject({ kind: 'handled', failed: true })
    expect(() => patchText()).toThrow()
  })

  it('refuses a server the layer already configures', async () => {
    const registry = makeRegistry()
    registry.connect('filesystem', ['read_file'])
    await dispatch(`/mcp add ${FILESYSTEM}`, makeCommand(registry.ctx))
    const again = await dispatch(`/mcp add ${FILESYSTEM}`, makeCommand(registry.ctx))
    expect(again).toMatchObject({ kind: 'handled', failed: true })
    expect(patchText().match(/id: mcp-filesystem/g)).toHaveLength(1)
  })

  it('writes without waiting in an assembly that has no tool registry', async () => {
    const result = await dispatch(`/mcp add ${FILESYSTEM}`, makeCommand(new Context()))
    expect(result.kind === 'handled' && result.failed).toBeUndefined()
    expect(patchText()).toContain('id: mcp-filesystem')
  })
})

describe('/mcp remove', () => {
  it('takes the row back out', async () => {
    const registry = makeRegistry()
    registry.connect('filesystem', ['read_file'])
    await dispatch(`/mcp add ${FILESYSTEM}`, makeCommand(registry.ctx))
    const result = await dispatch('/mcp remove filesystem', makeCommand(registry.ctx))
    expect(result.kind === 'handled' && result.failed).toBeUndefined()
    expect(patchText()).not.toContain('mcp-filesystem')
  })

  it('prints usage with no server named', async () => {
    const result = await dispatch('/mcp remove', makeCommand(makeRegistry().ctx))
    expect(result.kind === 'handled' && result.message).toContain('/mcp remove')
  })

  it('reports a server the layer does not configure', async () => {
    writeFileSync(join(home, PATCH_FILE), '[]\n')
    const result = await dispatch('/mcp remove nope', makeCommand(makeRegistry().ctx))
    expect(result).toMatchObject({ kind: 'handled', failed: true })
  })
})

describe('bare /mcp', () => {
  it('still lists what is connected, and is not confused by a server named add', async () => {
    const registry = makeRegistry()
    registry.connect('add', ['one'])
    const result = await dispatch('/mcp', makeCommand(registry.ctx))
    expect(result.kind === 'handled' && result.message).toContain('add — 1 tool')
  })

  it('points at /mcp add when nothing is connected', async () => {
    const result = await dispatch('/mcp', makeCommand(makeRegistry().ctx))
    expect(result.kind === 'handled' && result.message).toContain('/mcp add')
  })
})
