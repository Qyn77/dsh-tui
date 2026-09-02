/**
 * Plugin listing. `describePlugins` is fed hand-built entries rather than a
 * real loader: the point of {@link LoaderEntry} being structural is that the
 * classification and the ordering can be stated without standing up a config
 * tree, and a real `Entry` satisfies the same four fields (the compiler checks
 * that where `/plugins` calls it).
 */

import { describe, expect, it } from 'vitest'
import { describePlugins, formatPlugins, type LoaderEntry, type PluginPhase } from '../src/plugins.ts'

/** The numbers cordis's non-runtime `FiberState` const enum uses. */
const PENDING = 0
const LOADING = 1
const ACTIVE = 2
const FAILED = 3
const UNLOADING = 5

function entry(name: string, over?: Partial<LoaderEntry>): LoaderEntry {
  return {
    id: `entry:${name}`,
    disabled: false,
    options: { name },
    fiber: { state: ACTIVE },
    ...over,
  }
}

const LABELS: Record<PluginPhase, string> = {
  active: 'active',
  loading: 'loading',
  pending: 'pending',
  unloading: 'unloading',
  failed: 'failed',
  absent: 'not started',
  disabled: 'disabled',
}

describe('describePlugins', () => {
  it('maps each fiber state to its phase', () => {
    const rows = describePlugins([
      entry('a', { fiber: { state: PENDING } }),
      entry('b', { fiber: { state: LOADING } }),
      entry('c', { fiber: { state: ACTIVE } }),
      entry('d', { fiber: { state: FAILED } }),
      entry('e', { fiber: { state: UNLOADING } }),
    ])
    const phases = Object.fromEntries(rows.map(row => [row.name, row.phase]))
    expect(phases).toEqual({
      a: 'pending', b: 'loading', c: 'active', d: 'failed', e: 'unloading',
    })
  })

  it('calls a disabled entry disabled, not absent', () => {
    // A disabled plugin has no fiber by design. Reporting that as a failure
    // would make every deliberately-off plugin look broken.
    const rows = describePlugins([entry('off', { disabled: true, fiber: undefined })])
    expect(rows[0]?.phase).toBe('disabled')
  })

  it('calls an enabled entry with no fiber absent', () => {
    // This is the interesting case: the loader was told to load it and never
    // produced a fiber, which in practice means the import threw.
    const rows = describePlugins([entry('broken', { fiber: undefined })])
    expect(rows[0]?.phase).toBe('absent')
  })

  it('treats a state outside the mirrored table as absent', () => {
    // If cordis grows a state, a wrong label is worse than a vague one.
    const rows = describePlugins([entry('future', { fiber: { state: 99 } })])
    expect(rows[0]?.phase).toBe('absent')
  })

  it('skips groups, which are containers rather than plugins', () => {
    const rows = describePlugins([
      entry('group:tools', { options: { name: 'cordis/group', group: true } }),
      entry('real'),
    ])
    expect(rows.map(row => row.name)).toEqual(['real'])
  })

  it('falls back to the config id when an entry has no name', () => {
    const rows = describePlugins([entry('x', { id: 'anon:1234', options: {} })])
    expect(rows[0]?.name).toBe('anon:1234')
  })

  it('puts the broken ones first and the disabled ones last', () => {
    const rows = describePlugins([
      entry('zeta'),
      entry('off', { disabled: true, fiber: undefined }),
      entry('gone', { fiber: undefined }),
      entry('alpha'),
      entry('bad', { fiber: { state: FAILED } }),
      entry('slow', { fiber: { state: LOADING } }),
    ])
    expect(rows.map(row => row.name)).toEqual(['bad', 'gone', 'slow', 'alpha', 'zeta', 'off'])
  })

  it('sorts by name inside one severity band', () => {
    const rows = describePlugins([entry('b'), entry('a'), entry('c')])
    expect(rows.map(row => row.name)).toEqual(['a', 'b', 'c'])
  })

  it('reports nothing for an empty loader', () => {
    expect(describePlugins([])).toEqual([])
  })

  it('carries the config id through, since that is what a user would edit', () => {
    const rows = describePlugins([entry('pkg', { id: 'include:9f8e' })])
    expect(rows[0]?.id).toBe('include:9f8e')
  })
})

describe('formatPlugins', () => {
  it('aligns the phase column across rows of differing name length', () => {
    const rows = describePlugins([entry('short'), entry('a-much-longer-name')])
    const lines = formatPlugins(rows, LABELS).split('\n')
    const columns = lines.map(line => line.indexOf('active'))
    expect(columns[0]).toBe(columns[1])
  })

  it('marks failure, health and disablement with distinct glyphs', () => {
    const rows = describePlugins([
      entry('bad', { fiber: { state: FAILED } }),
      entry('good'),
      entry('off', { disabled: true, fiber: undefined }),
    ])
    const lines = formatPlugins(rows, LABELS).split('\n')
    expect(lines[0]).toContain('✗')
    expect(lines[1]).toContain('✓')
    expect(lines[2]).toContain('○')
  })

  it('uses the labels it is given, so the table can be translated', () => {
    const rows = describePlugins([entry('pkg')])
    expect(formatPlugins(rows, { ...LABELS, active: '运行中' })).toContain('运行中')
  })

  it('renders nothing for no rows rather than a stray blank line', () => {
    expect(formatPlugins([], LABELS)).toBe('')
  })
})
