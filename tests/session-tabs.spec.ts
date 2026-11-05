import { expect, it } from 'vitest'
import { createSessionTabs } from '../src/terminal/session-tabs.ts'

it('keeps unique tab order and wraps navigation without deleting durable sessions', () => {
  const tabs = createSessionTabs('a')
  tabs.open('b'); tabs.open('a'); tabs.open('c')
  expect(tabs.list()).toEqual(['a', 'b', 'c'])
  expect(tabs.target('c', 'next')).toBe('a')
  expect(tabs.target('a', 'prev')).toBe('c')
  tabs.close('b'); expect(tabs.list()).toEqual(['a', 'c'])
  tabs.close('a'); tabs.close('c'); expect(tabs.list()).toEqual(['c'])
  const copy = tabs.list(); copy.push('not-a-tab')
  expect(tabs.list()).toEqual(['c'])
})
