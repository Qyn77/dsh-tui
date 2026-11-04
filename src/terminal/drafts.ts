import { dshHome } from '../mcp/mcp-patch.ts'
import { readSessionData, removeSessionData, sessionFile, writeSessionData } from './session-files.ts'

export interface DraftSnapshot { text: string; cursor: number }
export interface DraftChannel {
  load: () => { draft?: DraftSnapshot; failed?: true }
  save: (draft: DraftSnapshot) => boolean
}
export interface DraftRepository { open: (session: string) => DraftChannel }
export const DRAFT_MAX_BYTES = 2 * 1024 * 1024
export const DRAFT_SAVE_MS = 200

export function parseDraft(value: unknown, session: string): DraftSnapshot | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('session' in value) || value.session !== session || !('text' in value) || typeof value.text !== 'string'
    || Buffer.byteLength(value.text) > DRAFT_MAX_BYTES || !('cursor' in value) || typeof value.cursor !== 'number'
    || !Number.isSafeInteger(value.cursor)) return undefined
  let cursor = Math.max(0, Math.min(value.cursor, value.text.length))
  if (cursor > 0 && cursor < value.text.length && /[\uDC00-\uDFFF]/.test(value.text[cursor])
    && /[\uD800-\uDBFF]/.test(value.text[cursor - 1])) cursor--
  return { text: value.text, cursor }
}

export function createDraftRepository(root = dshHome()): DraftRepository {
  return { open(session) {
    const path = sessionFile(root, 'tui-drafts', session)
    return {
      load() {
        const read = readSessionData(path, 6 * DRAFT_MAX_BYTES + 1024)
        if (read.failed || read.value === undefined) return read.failed ? { failed: true } : {}
        const draft = parseDraft(read.value, session)
        return draft ? { draft } : { failed: true }
      },
      save(draft) {
        if (Buffer.byteLength(draft.text) > DRAFT_MAX_BYTES) return false
        if (draft.text === '') return removeSessionData(path)
        return writeSessionData(path, { version: 1, session, ...draft })
      },
    }
  } }
}
