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
