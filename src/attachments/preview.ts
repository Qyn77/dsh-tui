import { stat } from 'node:fs/promises'
import { displayName, findImageCandidates, resolveCandidate, type ImageCandidate } from './attachments.ts'

export interface ImagePreview { candidate: ImageCandidate; name: string; bytes: number }

/** Metadata only; the attachment store revalidates bytes at submission. */
export async function previewImages(text: string, cwd: string, home?: string): Promise<ImagePreview[]> {
  const rows = await Promise.all(findImageCandidates(text).map(async candidate => {
    const path = resolveCandidate(candidate, { cwd, home })
    if (!path) return undefined
    try {
      const info = await stat(path)
      return info.isFile() ? { candidate, name: displayName(candidate), bytes: info.size } : undefined
    } catch { return undefined }
  }))
  return rows.filter((row): row is ImagePreview => row !== undefined)
}

export function removePreview(text: string, preview: ImagePreview): { text: string; cursor: number } {
  const { start, end } = preview.candidate
  return { text: text.slice(0, start) + text.slice(end), cursor: start }
}
