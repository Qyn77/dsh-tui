import type { Catalog } from '../core/i18n.ts'
import type { CommandMeta } from '../commands/commands.ts'

/** A branch only navigates; leaves either dispatch or hand free text to the editor. */
export interface MenuItem {
  id: string
  label: string
  description?: string
  current?: boolean
  children?: readonly MenuItem[]
  action?: { kind: 'run' | 'input'; value: string }
}
export type MenuSettings = Partial<Record<'language' | 'theme' | 'keybinds' | 'mouse' | 'notify' | 'approval' | 'verbose' | 'history', string>>

export function settingMenus(labels: Catalog['menu'], settings: MenuSettings = {}): MenuItem[] {
  const choices = (name: keyof MenuSettings, values: readonly (keyof Catalog['menu'])[]): MenuItem => ({
    id: `/${name}`, label: `/${name}`, children: values.map(value => ({
      id: value, label: labels[value], current: settings[name] === value,
      description: name === 'approval' ? labels.approvalWarning : value,
      action: { kind: 'run', value: `/${name} ${value}` },
    })),
  })
  return [choices('language', ['zh', 'en']), choices('theme', ['auto', 'dark', 'light']),
    choices('keybinds', ['default', 'vim']), choices('mouse', ['auto', 'on', 'off']),
    choices('notify', ['off', 'bell', 'desktop', 'test']), choices('approval', ['ask', 'never']),
    choices('verbose', ['off', 'on']), choices('history', ['show', 'hide'])]
}

export function menuPage(roots: readonly MenuItem[], path: readonly string[]): MenuItem | undefined {
  let children = roots
  let found: MenuItem | undefined
  for (const id of path) {
    found = children.find(item => item.id === id)
    if (!found) return undefined
    children = found.children ?? []
  }
  return found
}

export function menuChoices(page: MenuItem | undefined, query: string): readonly MenuItem[] {
  const needle = query.trim().toLocaleLowerCase()
  return (page?.children ?? []).filter(item => `${item.label} ${item.description ?? ''} ${item.id} ${item.action?.value ?? ''}`.toLocaleLowerCase().includes(needle))
}

export function menuRows(items: readonly MenuItem[], labels: Catalog['menu']): CommandMeta[] {
  return items.length ? items.map(item => ({ name: item.id,
    displayName: `${item.current ? '✓ ' : ''}${item.label}${item.children ? ' ›' : ''}`,
    description: item.description ?? '',
  })) : [{ name: '__empty', displayName: labels.empty, description: '' }]
}
