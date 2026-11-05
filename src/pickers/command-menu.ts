import { displayWidth } from '../core/width.ts'
import type { UiState, UiEntry } from '../core/types.ts'
import type { PluginRow } from '../commands/plugins.ts'
import { entryText } from '../commands/transcript.ts'
import { recoveryPlan } from '../commands/recovery.ts'
import { transcriptDiffs } from '../render/file-diffs.ts'
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

export interface MenuData {
  /** Only materialize large transcript choices while their command is open. */
  root?: string
  state: UiState
  fullState?: UiState
  historyReady?: boolean
  sessions?: readonly CommandMeta[]
  resumeSessions?: readonly CommandMeta[]
  sessionId?: string
  models?: readonly CommandMeta[]
  providers?: readonly { id: string; name: string }[]
  plugins?: readonly PluginRow[]
  mcpServers?: readonly string[]
  mcpPresets?: readonly CommandMeta[]
  queue?: readonly { id: string; text: string }[]
  currentContext?: readonly { role: string; content: readonly unknown[] }[]
  requestContext?: readonly { role: string; content: readonly unknown[] }[]
  failedDraft?: boolean
  activity?: ReadonlySet<number>
  allActivity?: boolean
}

/** Readable, single-row previews. Transcript text stays data, never command syntax. */
function preview(text: string): string {
  const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  let result = ''
  let width = 0
  for (const char of clean) {
    width += displayWidth(char)
    if (width > 100) return result + '…'
    result += char
  }
  return result
}

export function commandMenus(strings: Catalog, settings: MenuSettings, data: MenuData): MenuItem[] {
  const l = strings.menu
  const leaf = (id: string, label: string, value: string, description?: string): MenuItem =>
    ({ id, label, description, action: { kind: 'run', value } })
  const input = (id: string, label: string, value: string, description?: string): MenuItem =>
    ({ id, label, description, action: { kind: 'input', value } })
  const branch = (id: string, label: string, children: readonly MenuItem[], description?: string): MenuItem =>
    ({ id, label, children, description })
  const confirm = (id: string, label: string, command: string, warning: string): MenuItem =>
    branch(id, label, [leaf('confirm', l.confirm, command, `${label} · ${warning}`)], warning)
  const entries = data.state.entries
  const full = data.fullState ?? data.state
  const entryChoices = (command: string, source = entries, predicate: (entry: UiEntry) => boolean = () => true): MenuItem[] =>
    (data.root !== undefined && data.root !== command ? [] : source).flatMap((entry, index) => predicate(entry) ? [leaf(String(index + 1), `${index + 1}. ${preview(entryText(entry)) || entry.kind}`,
      `${command} ${index + 1}`, entry.kind)] : []).reverse()
  const taskChoices = (command: string, source = data.state): MenuItem[] =>
    (data.root !== undefined && data.root !== command ? [] : source.tasks ?? []).map((task) => {
      const text = source.entries.slice(task.startIndex, task.endIndex).find(entry => entry.kind === 'user')
      const seconds = task.startedAt !== undefined && task.endedAt !== undefined
        ? Math.max(0, Math.round((task.endedAt - task.startedAt) / 1000)) : undefined
      return leaf(String(task.turn), `${l.task} ${task.turn} · ${text ? preview(entryText(text)) : ''}`, `${command} ${task.turn}`,
        strings.activity.summary(task.turn, seconds, 0, false, task.outcome ?? strings.status.working))
    }).reverse()
  const activity = taskChoices('/activity').map(item => ({ ...item, current: data.allActivity || data.activity?.has(Number(item.id)) }))
  const sessions = (data.sessions ?? []).map(row => ({ ...row, id: row.name.replace(/^\/resume\s+/, '') }))
  // The active session must remain manageable even while the async catalog loads.
  if (!sessions.some(row => row.id === data.sessionId)) sessions.unshift({ id: 'current', name: '', displayName: l.current, description: data.sessionId ?? '' })
  const sessionTargets = (action: string): MenuItem[] => sessions.map((row) => {
    const title = `${row.id === data.sessionId ? l.current + ' · ' : ''}${row.displayName ?? row.id}`
    if (action === 'rename') return branch(row.id, title, [input('title', l.title, `/sessions rename ${row.id} `),
      leaf('reset', l.reset, `/sessions rename ${row.id} --reset`)], preview(row.description))
    return branch(row.id, title, ['on', 'off'].map(value => leaf(value, value === 'on' ? l.on : l.off, `/sessions ${action} ${row.id} ${value}`)), preview(row.description))
  })
  const queueTargets = (action: 'edit' | 'remove'): MenuItem[] => (data.queue ?? []).map(row => action === 'edit'
    ? input(row.id, preview(row.text) || row.id, `/queue edit ${row.id} ${row.text}`, row.id)
    : confirm(row.id, preview(row.text) || row.id, `/queue remove ${row.id}`, l.queueWarning))
  const contextChoices = (mode: 'view' | 'request', messages: MenuData['currentContext']): MenuItem => branch(mode, l[mode], [
    leaf('list', l.list, `/context ${mode}`), leaf('tools', l.tools, `/context ${mode} tools`),
    ...(messages ?? []).map((message, index) => leaf(String(index + 1), `${index + 1}. ${message.role}`, `/context ${mode} ${index + 1}`,
      preview(message.content.flatMap(block => typeof block === 'object' && block !== null && 'text' in block ? [String(block.text)] : []).join(' ')))),
  ])
  const recover = recoveryPlan(data.state)
  return [...settingMenus(l, settings),
    branch('/activity', '/activity', [leaf('all', l.all, '/activity all'), leaf('none', l.none, '/activity none'), ...activity]),
    branch('/copy', '/copy', [leaf('latest', l.latest, '/copy'), leaf('code', l.code, '/copy code'), branch('messages', l.messages, entryChoices('/copy'))]),
    branch('/inspect', '/inspect', entryChoices('/inspect')),
    branch('/jump', '/jump', [...(['next', 'prev', 'user', 'tool', 'error'] as const).map(key => leaf(key, l[key], `/jump ${key}`)), branch('messages', l.messages, entryChoices('/jump'))]),
    branch('/changes', '/changes', data.historyReady === false ? [] : [leaf('latest', l.latest, '/changes'), ...taskChoices('/changes', full)]),
    branch('/diff', '/diff', [leaf('all', l.full, '/diff'), ...entryChoices('/diff', entries, entry => transcriptDiffs([entry]).length > 0)]),
    branch('/retry', '/retry', [leaf('list', l.list, '/retry'), ...(recover ? [leaf('continue', l.continue, '/retry continue')] : []),
      ...(recover || data.failedDraft ? [leaf('draft', l.draft, '/retry draft')] : [])]),
    branch('/branch', '/branch', data.historyReady === false ? [] : [leaf('current', l.fork, '/branch'), ...taskChoices('/branch', full)]),
    branch('/resume', '/resume', [leaf('last', l.latest, '/resume last'), ...(data.resumeSessions ?? []).map(row => leaf(row.name, row.displayName ?? row.name, row.name, preview(row.description)))]),
    branch('/sessions', '/sessions', [branch('resume', l.resume, (data.sessions ?? []).filter(row => row.name !== `/resume ${data.sessionId}`).map(row => leaf(row.name, row.displayName ?? row.name, row.name, preview(row.description)))),
      ...(['rename', 'favorite', 'archive'] as const).map(action => branch(action, l[action], sessionTargets(action))),
      leaf('active', l.active, '/sessions'), leaf('all', l.allSessions, '/sessions all'), leaf('archived', l.archived, '/sessions archived')]),
    branch('/queue', '/queue', [leaf('list', l.list, '/queue'), input('add', l.add, '/queue add ', l.input),
      branch('edit', l.edit, queueTargets('edit')), branch('remove', l.remove, queueTargets('remove')),
      ...((data.queue?.length ?? 0) > 0 ? [confirm('clear', l.clear, '/queue clear', l.queueWarning)] : [])]),
    branch('/mcp', '/mcp', [leaf('list', l.list, '/mcp'), branch('add', l.add, [
      ...(data.mcpPresets ?? []).map(row => leaf(row.name, row.displayName ?? row.name, `/mcp add ${row.name}`, row.description)),
      input('custom', l.pasteConfig, '/mcp add ')]),
    branch('remove', l.remove, (data.mcpServers ?? []).map(id => confirm(id, id, `/mcp remove ${id}`, l.removeWarning)))]),
    branch('/plugins', '/plugins', [leaf('list', l.list, '/plugins'), ...(data.plugins ?? []).map(row =>
      branch(row.id, row.name, row.lock ? [] : [confirm('toggle', row.phase === 'disabled' ? l.enable : l.disable,
        `/plugins ${row.phase === 'disabled' ? 'enable' : 'disable'} ${row.id}`, row.id)], row.lock ? l.locked : row.phase))]),
    branch('/provider', '/provider', [leaf('list', l.list, '/provider'), ...(data.providers ?? []).map(provider =>
      branch(provider.id, provider.name, (data.models ?? []).filter(row => row.name.startsWith(`${provider.id}/`)).map(row =>
        leaf(row.name, row.displayName ?? row.name, `/model ${row.name}`, row.description)), provider.id))]),
    branch('/context', '/context', [leaf('list', l.list, '/context'), contextChoices('view', data.currentContext), contextChoices('request', data.requestContext)]),
    branch('/export', '/export', data.historyReady === false ? [] : [input('all', l.exportAll, '/export ', l.path),
      branch('messages', l.exportOne, (data.root !== undefined && data.root !== '/export' ? [] : full.entries).map((entry, index) => input(String(index + 1), `${index + 1}. ${preview(entryText(entry)) || entry.kind}`,
        `/export --entry=${index + 1} `, l.path)).reverse())]),
  ]
}

/** Let complete command syntax win over a filter miss, including free-text tails. */
export function acceptsManualCommand(roots: readonly MenuItem[], raw: string): boolean {
  const text = raw.trim()
  return roots.some((item) => {
    if (item.children && acceptsManualCommand(item.children, raw)) return true
    if (!item.action) return false
    if (item.action.kind === 'run') return item.action.value === text
    // Queue editing preloads the old text; only the command and stable ID are fixed.
    const prefix = item.action.value.startsWith('/queue edit ')
      ? item.action.value.split(/\s+/).slice(0, 3).join(' ') + ' ' : item.action.value
    return text.startsWith(prefix) && text.length > prefix.length
  })
}
