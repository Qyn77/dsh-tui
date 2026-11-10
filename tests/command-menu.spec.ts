import { describe, expect, it } from 'vitest'
import { catalog } from '../src/core/i18n.ts'
import { settingMenus, menuPage, menuChoices, menuRows } from '../src/pickers/command-menu.ts'

describe('known command choices', () => {
  it('exposes explicit settings without toggling merely by entering a branch', () => {
    const roots = settingMenus(catalog('en').menu, { theme: 'dark' })
    expect(roots.every(root => !root.action)).toBe(true)
    const page = menuPage(roots, ['/theme'])!
    expect(page.children?.find(row => row.current)?.action?.value).toBe('/theme dark')
    expect(page.children?.map(row => row.action?.value)).toEqual(['/theme auto', '/theme dark', '/theme light'])
  })
  it('filters localized labels and identifiers and keeps empty choices non-executable', () => {
    const labels = catalog('zh').menu
    const page = menuPage(settingMenus(labels), ['/theme'])
    expect(menuChoices(page, '深色')[0].action?.value).toBe('/theme dark')
    expect(menuChoices(page, 'light')[0].label).toBe('浅色')
    expect(menuChoices(page, 'missing')).toEqual([])
    expect(menuRows([], labels)[0].displayName).toContain('没有匹配')
    expect(menuPage(settingMenus(labels), ['/theme', 'removed'])).toBeUndefined()
  })
})

import { commandMenus, type MenuItem } from '../src/pickers/command-menu.ts'
import type { UiState } from '../src/core/types.ts'
const state: UiState = { entries: [{ kind: 'note', text: 'first message' }, { kind: 'note', text: 'second message' }],
  status: 'idle', currentTurn: 2, tasks: [{ turn: 1, startIndex: 0, endIndex: 1, startedAt: 1000, endedAt: 4000, outcome: 'completed' }] }
const data = { state, sessions: [{ name: '/resume session-123', displayName: 'My session', description: 'A saved conversation' }],
  providers: [{ id: 'one', name: 'First provider' }, { id: 'two', name: 'Second provider' }],
  models: [{ name: 'one/model-a', description: 'A' }, { name: 'two/model-b', description: 'B' }],
  queue: [{ id: 'message-123', text: 'do something' }], mcpServers: ['memory'],
  plugins: [{ id: 'plugin-123', name: 'test-plugin', phase: 'active' as const }, { id: 'tui', name: 'tui', phase: 'active' as const, lock: 'self' as const }],
  currentContext: [{ role: 'user', content: [{ type: 'text', text: 'hello context' }] }],
}
function at(...path: string[]): MenuItem { return menuPage(commandMenus(catalog('en'), {}, data), path)! }

it('keeps complete emoji in message previews at their display width', () => {
  const family = '👨‍👩‍👧‍👦'
  const roots = commandMenus(catalog('en'), {}, { root: '/inspect',
    state: { entries: [{ kind: 'note', text: family.repeat(50) + 'x' }], status: 'idle', currentTurn: 1 } })
  expect(menuPage(roots, ['/inspect'])?.children?.[0]?.label).toBe('1. ' + family.repeat(50) + '…')
})

it('covers all enumerated command families while leaving search free-form', () => {
  const roots = commandMenus(catalog('en'), {}, data)
  expect(roots.map(root => root.id)).toEqual(expect.arrayContaining(['/activity', '/copy', '/inspect', '/jump', '/changes', '/diff',
    '/retry', '/branch', '/sessions', '/queue', '/mcp', '/plugins', '/provider', '/context', '/export']))
  expect(roots.some(root => root.id === '/search')).toBe(false)
  expect(at('/inspect', '2').action?.value).toBe('/inspect 2')
  expect(at('/activity', '1').description).toContain('worked for 3s')
  expect(at('/context', 'view', '1').action?.value).toBe('/context view 1')
})
it('uses stable IDs for queue and session operations and stages free text', () => {
  expect(at('/sessions', 'favorite', 'session-123', 'on').action?.value).toBe('/sessions favorite session-123 on')
  expect(at('/sessions', 'rename', 'session-123', 'title').action).toEqual({ kind: 'input', value: '/sessions rename session-123 ' })
  expect(at('/queue', 'edit', 'message-123').action).toEqual({ kind: 'input', value: '/queue edit message-123 do something' })
  expect(at('/export', 'messages', '2').action).toEqual({ kind: 'input', value: '/export --entry=2 ' })
})
it('requires a deliberate confirmation for removal and respects plugin locks', () => {
  expect(at('/mcp', 'remove', 'memory').action).toBeUndefined()
  expect(at('/mcp', 'remove', 'memory', 'confirm').action?.value).toBe('/mcp remove memory')
  expect(at('/queue', 'remove', 'message-123', 'confirm').action?.value).toBe('/queue remove message-123')
  expect(at('/plugins', 'tui').children).toEqual([])
  expect(at('/plugins', 'plugin-123', 'toggle', 'confirm').action?.value).toBe('/plugins disable plugin-123')
})
it('selects models under the chosen provider without editing credentials', () => {
  expect(at('/provider', 'two').children?.map(item => item.action?.value)).toEqual(['/model two/model-b'])
})
it('does not offer exports of partial history or recovery actions without a failure', () => {
  const roots = commandMenus(catalog('en'), {}, { state, historyReady: false })
  expect(menuPage(roots, ['/export'])?.children).toEqual([])
  expect(menuPage(roots, ['/branch'])?.children).toEqual([])
  expect(menuPage(roots, ['/retry'])?.children?.map(row => row.id)).toEqual(['list'])
})
