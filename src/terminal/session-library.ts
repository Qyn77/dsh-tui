import { displayWidth } from '../core/width.ts'
import { dshHome } from '../mcp/mcp-patch.ts'
import { readSessionData, sessionFile, writeSessionData } from './session-files.ts'

export interface SessionMetadata { title?: string; favorite?: boolean; archived?: boolean }
export interface SessionLibrary {
  read: (session: string) => { metadata: SessionMetadata; failed?: true }
  update: (session: string, patch: { title?: string | null; favorite?: boolean; archived?: boolean }) => boolean
}
export function validSessionTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !/[\u0000-\u001f\u007f-\u009f]/.test(value) && displayWidth(value) <= 120
}
function parseMetadata(value: unknown, session: string): SessionMetadata | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('session' in value) || value.session !== session) return undefined
  if ('title' in value && !validSessionTitle(value.title)) return undefined
  if ('favorite' in value && typeof value.favorite !== 'boolean') return undefined
  if ('archived' in value && typeof value.archived !== 'boolean') return undefined
  return { ...('title' in value ? { title: value.title as string } : {}),
    ...('favorite' in value ? { favorite: value.favorite as boolean } : {}),
    ...('archived' in value ? { archived: value.archived as boolean } : {}) }
}
export function createSessionLibrary(root = dshHome()): SessionLibrary {
  const path = (session: string): string => sessionFile(root, 'tui-sessions', session)
  return {
    read(session) {
      const read = readSessionData(path(session), 32768)
      if (read.failed) return { metadata: {}, failed: true }
      if (read.value === undefined) return { metadata: {} }
      const metadata = parseMetadata(read.value, session)
      return metadata ? { metadata } : { metadata: {}, failed: true }
    },
    update(session, patch) {
      const read = readSessionData(path(session), 32768)
      if (read.failed || (read.value !== undefined && !parseMetadata(read.value, session))) return false
      const next = { ...(read.value as Record<string, unknown> | undefined), ...patch, version: 1, session }
      if (next.title === null) delete next.title
      if (!parseMetadata(next, session) || Buffer.byteLength(JSON.stringify(next)) > 32768) return false
      return writeSessionData(path(session), next)
    },
  }
}
