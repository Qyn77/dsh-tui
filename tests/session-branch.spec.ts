import { expect, it } from 'vitest'
import { branchSeed } from '../src/commands/session-branch.ts'
import { seedSession } from './fake-tty.ts'
import { recordedEvents } from './recorded-session.ts'

it('uses a complete selected turn prefix and retains native fork lineage markers', () => {
  const source = recordedEvents(seedSession(2))
  const before = JSON.stringify(source)
  const result = branchSeed(source, 1)!
  expect(result.seed.at(-1)).toMatchObject({ type: 'session/end-seed', data: { inherited: true } })
  expect(result.seed.some(event => event.type === 'turn/start' && event.data.turn === 2)).toBe(false)
  expect(result.inheritedEventCount).toBe(result.seed.length - 1)
  expect(JSON.stringify(source)).toBe(before)
  expect(branchSeed(source, 99)).toBeUndefined()
})
it('allows an empty fork without fabricating source events', () => {
  expect(branchSeed([])).toEqual({ seed: [], inheritedEventCount: 0 })
  expect(branchSeed([], 1)).toBeUndefined()
})
