/**
 * Pure mechanics of the `/mcp add ` picker: anchored query tokens, the paste
 * guard, row mapping through a description lookup, fill, filter, and the
 * submitted line.
 *
 * @module @qiao-qyn/dsh-tui/tests/mcp-picker.spec
 */

import { describe, expect, it } from 'vitest'
import { MCP_PRESETS, type McpPreset } from '../src/mcp/mcp-catalog.ts'
import {
  applyMcpMention,
  filterMcpPresetRows,
  mcpMentionAt,
  mcpPresetCommandLine,
  mcpPresetRows,
} from '../src/pickers/mcp-picker.ts'

const describePreset = (preset: McpPreset): string => `desc ${preset.name}`
const rows = mcpPresetRows(describePreset)

describe('mcpMentionAt', () => {
  it('opens right after the anchoring space with an empty query', () => {
    expect(mcpMentionAt('/mcp add ', 9)).toEqual({ query: '', start: 9, end: 9 })
  })

  it('captures the whole token regardless of the caret inside it', () => {
    expect(mcpMentionAt('/mcp add mem', 12)).toEqual({ query: 'mem', start: 9, end: 12 })
  })

  it('closes once a second token exists — a pasted block is not a filter', () => {
    const buffer = '/mcp add {"mcpServers": {"x": {}}}'
    expect(mcpMentionAt(buffer, buffer.length)).toBeUndefined()
  })

  it('does not match bare /mcp or /mcp without the trailing space', () => {
    expect(mcpMentionAt('/mcp', 5)).toBeUndefined()
    expect(mcpMentionAt('/mcp ad', 8)).toBeUndefined()
  })
})

describe('mcpPresetRows', () => {
  it('names each row by the bare preset word, one per catalog entry', () => {
    expect(rows.map(row => row.name)).toEqual(MCP_PRESETS.map(preset => preset.name))
    expect(rows[0]?.description).toBe(`desc ${MCP_PRESETS[0]?.name}`)
  })
})

describe('mcpPresetCommandLine', () => {
  it('builds the full command line', () => {
    expect(mcpPresetCommandLine('memory')).toBe('/mcp add memory')
  })
})

describe('applyMcpMention', () => {
  it('replaces the token and leaves a trailing space', () => {
    const mention = mcpMentionAt('/mcp add mem', 13)
    expect(mention).toBeDefined()
    if (mention === undefined) return
    expect(applyMcpMention('/mcp add mem', mention, 'memory')).toEqual({
      text: '/mcp add memory ',
      cursor: 16,
    })
  })
})

describe('filterMcpPresetRows', () => {
  it('prefix-matches case-insensitively', () => {
    expect(filterMcpPresetRows(rows, 'SEQ').map(row => row.name)).toEqual(['sequential-thinking'])
  })

  it('keeps every row on an empty query, in catalog order', () => {
    expect(filterMcpPresetRows(rows, '')).toEqual(rows)
  })

  it('returns nothing for a brace-headed token — the picker never claims a paste', () => {
    expect(filterMcpPresetRows(rows, '{"mcpServers"')).toEqual([])
  })
})
