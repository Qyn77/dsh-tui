import type { SessionLibrary } from '../terminal/session-library.ts'
import { catalog, type Lang } from '../core/i18n.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { service } from '../core/services.ts'
import { shortId, summarizeLog } from './sessions.ts'
import type { CommandMeta } from './commands.ts'

/** Load only on picker demand; each handle is closed even after read failure. */
export async function sessionCatalog(ctx: Context, agent: Agent,
  options: { library?: SessionLibrary; lang?: Lang } = {}): Promise<CommandMeta[]> {
  const persistence = service(ctx, 'sessionPersistence')
  if (!persistence) return []
  await service(ctx, 'sessions')?.flush(agent.session)
  const snapshots = await persistence.list()
  const strings = catalog(options.lang ?? 'en').library
  const rows: Array<{ id: string; title: string; cwd: string; time: number; activity: boolean; favorite: boolean; failed: boolean }> = []
  // Sequential handles avoid exhausting descriptors on large session libraries.
  for (const snapshot of snapshots) {
    const header = snapshot.header
    const labels = options.library?.read(header.id)
    if (labels?.metadata.archived) continue
    let title = ''
    let lastActivity: number | undefined
    let handle: Awaited<ReturnType<typeof persistence.open>> | undefined
    try {
      handle = await persistence.open(header.id, 'read')
      const { events } = await handle.read(0, 64)
      title = summarizeLog(events) ?? ''
      if (snapshot.eventCount && snapshot.eventCount > 0) {
        lastActivity = (await handle.read(snapshot.eventCount - 1, 1)).events[0]?.time
      }
    } catch {
      // Keep unreadable sessions discoverable by id so their resume error is
      // reachable; one broken log must not hide the rest of the catalog.
    } finally { await handle?.close() }
    rows.push({ id: header.id, title: labels?.metadata.title ?? title, favorite: labels?.metadata.favorite ?? false, failed: labels?.failed ?? false, cwd: header.cwd ?? '',
      time: lastActivity ?? header.createdAt, activity: lastActivity !== undefined })
  }
  return rows.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.time - a.time).filter(row => row.id !== agent.id).map(row => ({
    name: `/resume ${row.id}`,
    displayName: `${row.favorite ? strings.favoriteTag + ' ' : ''}${shortId(row.id as never)}`,
    description: `${row.failed ? strings.failedTag + ' ' : ''}${row.title || row.id} · ${row.cwd} · ${new Date(row.time).toISOString().slice(0, 16).replace('T', ' ')}${row.activity ? '' : ' *'}`,
  }))
}
