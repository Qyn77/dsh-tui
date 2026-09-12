/**
 * Pure mechanics of `/provider`: the live-route lookup and the row layout.
 *
 * @module @deepseek-ai/dsh-tui/tests/providers.spec
 */

import { describe, expect, it } from 'vitest'
import { formatProviderRows, selectProviderRow } from '../src/commands/providers.ts'

const rows = [
  { id: 'deepseek-official', name: 'DeepSeek Official' },
  { id: 'openai-gateway', name: 'OpenAI' },
]

const rowLine = (id: string, name: string, current: boolean): string =>
  `${current ? '✓ ' : '  '}${id} — ${name}`

describe('selectProviderRow', () => {
  it('finds the selected route by id', () => {
    expect(selectProviderRow(rows, 'openai-gateway')).toBe(1)
  })

  it('returns -1 with no selection or an unknown route', () => {
    expect(selectProviderRow(rows, undefined)).toBe(-1)
    expect(selectProviderRow(rows, 'gone')).toBe(-1)
  })
})

describe('formatProviderRows', () => {
  it('draws one line per route and ticks the selected index only', () => {
    const out = formatProviderRows(rows, 0, rowLine)
    expect(out).toBe('  ✓ deepseek-official — DeepSeek Official\n    openai-gateway — OpenAI')
  })

  it('ticks nothing when the selection matched no row', () => {
    const out = formatProviderRows(rows, -1, rowLine)
    expect(out).not.toContain('✓')
    expect(out.split('\n')).toHaveLength(2)
  })

  it('is empty on no rows at all', () => {
    expect(formatProviderRows([], -1, rowLine)).toBe('')
  })
})
