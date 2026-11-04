import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { sessionCatalog } from '../src/commands/session-catalog.ts'
import { seedSession } from './fake-tty.ts'
import { recordedEvents } from './recorded-session.ts'

it('sorts by actual activity and keeps unreadable sessions discoverable', async () => {
  const ctx = new Context()
  const current = seedSession(0, 'current')
  const other = seedSession(1, 'other')
  const events = recordedEvents(other).map(event => ({ ...event, time: 50000 }))
  const close = vi.fn()
  ctx.provide('sessionPersistence', {
    list: async () => ['current', 'other', 'broken'].map((id, index) => ({
      header: { id, createdAt: index + 1000, cwd: `/workspace/${id}` }, eventCount: events.length,
    })),
    open: async (id: string) => {
      if (id === 'broken') throw new Error('unreadable')
      return { read: async (offset: number, length: number) => ({ events: events.slice(offset, offset + length) }), close }
    },
  } as never)
  const rows = await sessionCatalog(ctx, { id: current.id, session: current } as never)
  expect(rows).toHaveLength(2)
  expect(rows[0].name).toBe('/resume other')
  expect(rows[0].description).toContain('question 01')
  expect(rows[0].description).toContain('/workspace/other')
  expect(rows[1].name).toBe('/resume broken')
  expect(close).toHaveBeenCalledTimes(2)
})

it('pins favorites, uses renamed titles and hides archives before opening logs', async () => {
  const ctx = new Context()
  const open = vi.fn().mockResolvedValue({ read: async () => ({ events: [] }), close: async () => {} })
  ctx.provide('sessionPersistence', { list: async () => ['new', 'favorite', 'archived'].map((id, index) => ({
    header: { id, createdAt: 1000 - index, cwd: '/workspace' },
  })), open } as never)
  const library = { read: (id: string) => ({ metadata: { title: `Renamed ${id}`, favorite: id === 'favorite', archived: id === 'archived' } }),
    update: () => true }
  const agent = { id: 'current', session: seedSession(0) } as never
  const rows = await sessionCatalog(ctx, agent, { library })
  expect(rows.map(row => row.name)).toEqual(['/resume favorite', '/resume new'])
  expect(rows[0].displayName).toContain('★')
  expect(rows[0].description).toContain('Renamed favorite')
  expect(open).toHaveBeenCalledTimes(2)
})
