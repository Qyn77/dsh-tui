/**
 * Pure mechanics of the `/permission ` picker: anchoring the query token,
 * filling a choice, filtering rows, and turning the projection's options into
 * picker rows with the live value marked.
 *
 * @module @deepseek-ai/dsh-tui/tests/permission-picker.spec
 */

import { describe, expect, it } from 'vitest'
import type { PermissionPresetSelect } from '../src/core/types.ts'
import {
  CURRENT_PRESET_GLYPH,
  applyPermissionMention,
  filterPermissionRows,
  permissionCommandLine,
  permissionMentionAt,
  permissionRows,
} from '../src/pickers/permission-picker.ts'

const rows = [
  { name: 'read-only', description: 'Read-only' },
  { name: 'workspace-write', description: 'Workspace write' },
  { name: 'danger-full-access', description: 'Danger: full access' },
]

const select = (current: string): PermissionPresetSelect => ({
  currentValue: current,
  options: [
    { value: 'read-only', name: 'Read-only' },
    { value: 'workspace-write', name: 'Workspace write' },
    { value: 'danger-full-access', name: 'Danger: full access' },
  ],
})

describe('permissionMentionAt', () => {
  it('opens right after the anchoring space with an empty query', () => {
    expect(permissionMentionAt('/permission ', 12)).toEqual({ query: '', start: 12, end: 12 })
  })

  it('captures the token being typed, not the text up to the caret', () => {
    // Caret in the middle of `dan` still reports the whole token, so a
    // completion replaces all of it.
    expect(permissionMentionAt('/permission danger', 14)).toEqual({
      query: 'danger',
      start: 12,
      end: 18,
    })
  })

  it('closes once a second token exists', () => {
    expect(permissionMentionAt('/permission read only', 19)).toBeUndefined()
  })

  it('needs the anchor at position 0', () => {
    expect(permissionMentionAt(' /permission ', 13)).toBeUndefined()
  })

  it('does not match a command that starts with the word', () => {
    expect(permissionMentionAt('/permissioning x', 17)).toBeUndefined()
  })

  it('treats a newline after the command as "not this picker"', () => {
    expect(permissionMentionAt('/permission\nx', 14)).toBeUndefined()
  })

  it('clamps an out-of-range cursor', () => {
    expect(permissionMentionAt('/permission ro', 99)).toEqual({
      query: 'ro',
      start: 12,
      end: 14,
    })
  })
})

describe('permissionCommandLine', () => {
  it('builds the full plugin command line', () => {
    expect(permissionCommandLine('danger-full-access'))
      .toBe('/permission danger-full-access')
  })
})

describe('applyPermissionMention', () => {
  it('replaces the token and leaves a trailing space', () => {
    const mention = permissionMentionAt('/permission dan', 15)
    expect(mention).toBeDefined()
    if (mention === undefined) return
    expect(applyPermissionMention('/permission dan', mention, 'danger-full-access')).toEqual({
      text: '/permission danger-full-access ',
      cursor: 31,
    })
  })

  it('keeps text after the token as future arguments', () => {
    const mention = permissionMentionAt('/permission ro extra', 14)
    expect(mention).toBeDefined()
    if (mention === undefined) return
    const next = applyPermissionMention('/permission ro extra', mention, 'read-only')
    expect(next.text).toBe('/permission read-only  extra')
  })
})

describe('filterPermissionRows', () => {
  it('prefix-matches case-insensitively and keeps order', () => {
    expect(filterPermissionRows(rows, '').map(r => r.name))
      .toEqual(['read-only', 'workspace-write', 'danger-full-access'])
    expect(filterPermissionRows(rows, 'DAN').map(r => r.name))
      .toEqual(['danger-full-access'])
    expect(filterPermissionRows(rows, 'write')).toEqual([])
  })
})

describe('permissionRows', () => {
  it('uses bare preset values as names and projection names as descriptions', () => {
    const mapped = permissionRows(select('workspace-write'))
    expect(mapped[0]).toEqual({ name: 'read-only', description: 'Read-only' })
    expect(mapped[1]?.name).toBe('workspace-write')
  })

  it('marks only the current value', () => {
    const mapped = permissionRows(select('danger-full-access'))
    const marked = mapped.filter(r => r.description.startsWith(CURRENT_PRESET_GLYPH))
    expect(marked).toHaveLength(1)
    expect(marked[0]?.name).toBe('danger-full-access')
    expect(marked[0]?.description).toBe(`${CURRENT_PRESET_GLYPH} Danger: full access`)
  })
})
