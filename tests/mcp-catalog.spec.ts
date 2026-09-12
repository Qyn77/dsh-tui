/**
 * The preset catalog's invariants: every entry is a row the patch writer can
 * round-trip, every name is one the bridge accepts, and no entry carries a
 * credential — the boundary that makes a preset safe to write unseen.
 */

import { describe, expect, it } from 'vitest'
import { MCP_PRESETS, findPreset, presetRow } from '../src/mcp/mcp-catalog.ts'
import { SERVER_NAME_PATTERN, secretEnvKeys } from '../src/mcp/mcp-config.ts'

describe('MCP_PRESETS', () => {
  it('names every entry the way the bridge accepts', () => {
    for (const preset of MCP_PRESETS) {
      expect(SERVER_NAME_PATTERN.test(preset.name)).toBe(true)
    }
  })

  it('has no duplicate serverName', () => {
    const names = MCP_PRESETS.map(preset => preset.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('carries no credentials — the preset path exists to need none', () => {
    for (const preset of MCP_PRESETS) {
      expect(secretEnvKeys(presetRow(preset).config)).toEqual([])
    }
  })
})

describe('findPreset', () => {
  it('matches a catalog name exactly', () => {
    expect(findPreset('memory')?.name).toBe('memory')
  })

  it('does not match a prefix, a case variant, or a paste', () => {
    expect(findPreset('mem')).toBeUndefined()
    expect(findPreset('Memory')).toBeUndefined()
    expect(findPreset('{"mcpServers":{}}')).toBeUndefined()
  })
})

describe('presetRow', () => {
  it('builds the same row shape a paste produces', () => {
    const preset = MCP_PRESETS[0]
    expect(presetRow(preset)).toEqual({
      id: `mcp-${preset.name}`,
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        transport: 'stdio',
        serverName: preset.name,
        command: preset.command,
        args: [...preset.args],
      },
    })
  })

  it('copies the args, so a caller cannot mutate the catalog', () => {
    const preset = MCP_PRESETS[0]
    const row = presetRow(preset)
    if (row.config.transport !== 'stdio' || row.config.args === undefined) {
      throw new Error('preset rows are stdio with args')
    }
    row.config.args.push('injected')
    expect(preset.args).not.toContain('injected')
  })
})
