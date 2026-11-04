import { parseDraftImages, type DraftImage } from '../attachments/draft-images.ts'
import { dshHome } from '../mcp/mcp-patch.ts'
import { readSessionData, removeSessionData, sessionFile, writeSessionData } from './session-files.ts'

export interface DraftSnapshot { text: string; cursor: number; images?: readonly DraftImage[] }
export interface DraftChannel {
  load: () => { draft?: DraftSnapshot; failed?: true }
  save: (draft: DraftSnapshot) => boolean
}
export interface DraftRepository { open: (session: string) => DraftChannel }
export const DRAFT_MAX_BYTES = 2 * 1024 * 1024
export const DRAFT_SAVE_MS = 200

export function parseDraft(value: unknown, session: string): DraftSnapshot | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || (value.version !== 1 && value.version !== 2)
    || !('session' in value) || value.session !== session || !('text' in value) || typeof value.text !== 'string'
    || Buffer.byteLength(value.text) > DRAFT_MAX_BYTES || !('cursor' in value) || typeof value.cursor !== 'number'
    || !Number.isSafeInteger(value.cursor)) return undefined
  let cursor = Math.max(0, Math.min(value.cursor, value.text.length))
  if (cursor > 0 && cursor < value.text.length && /[\uDC00-\uDFFF]/.test(value.text[cursor])
    && /[\uD800-\uDBFF]/.test(value.text[cursor - 1])) cursor--
  const images = value.version === 2 && 'images' in value ? parseDraftImages(value.images) : undefined
  if (value.version === 2 && 'images' in value && !images) return undefined
  return { text: value.text, cursor, ...(images?.length ? { images } : {}) }
}

export function createDraftRepository(root = dshHome()): DraftRepository {
  return { open(session) {
    const path = sessionFile(root, 'tui-drafts', session)
    return {
      load() {
        const read = readSessionData(path, 6 * (DRAFT_MAX_BYTES + 1024 * 1024) + 1024)
        if (read.failed || read.value === undefined) return read.failed ? { failed: true } : {}
        const draft = parseDraft(read.value, session)
        return draft ? { draft } : { failed: true }
      },
      save(draft) {
        if (Buffer.byteLength(draft.text) > DRAFT_MAX_BYTES || (draft.images && !parseDraftImages(draft.images))) return false
        if (draft.text === '' && !draft.images?.length) return removeSessionData(path)
        return writeSessionData(path, { version: 2, session, ...draft })
      },
    }
  } }
}
