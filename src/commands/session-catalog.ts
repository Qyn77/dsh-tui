import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { service } from '../core/services.ts'
import { shortId, summarizeLog } from './sessions.ts'
import type { CommandMeta } from './commands.ts'

/** Load only on picker demand; each handle is closed even after read failure. */
export async function sessionCatalog(ctx: Context, agent: Agent): Promise<CommandMeta[]> {
  const persistence = service(ctx, 'sessionPersistence')
  if (!persistence) return []
  await service(ctx, 'sessions')?.flush(agent.session)
  const snapshots = await persistence.list()
  const rows: Array<{ id: string; title: string; cwd: string; time: number; activity: boolean }> = []
  // Sequential handles avoid exhausting descriptors on large session libraries.
  for (const snapshot of snapshots) {
    const header = snapshot.header
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
    rows.push({ id: header.id, title, cwd: header.cwd ?? '',
      time: lastActivity ?? header.createdAt, activity: lastActivity !== undefined })
  }
  return rows.sort((a, b) => b.time - a.time).filter(row => row.id !== agent.id).map(row => ({
    name: `/resume ${row.id}`,
    displayName: shortId(row.id as never),
    description: `${row.title || row.id} · ${row.cwd} · ${new Date(row.time).toISOString().slice(0, 16).replace('T', ' ')}${row.activity ? '' : ' *'}`,
  }))
}
