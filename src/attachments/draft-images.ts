import { isAbsolute } from 'node:path'

export interface DraftImage { path: string; name?: string }
export const EMPTY_IMAGES: readonly DraftImage[] = []
export const MAX_DRAFT_IMAGES = 64

export function sameImages(a: readonly DraftImage[] = EMPTY_IMAGES, b: readonly DraftImage[] = EMPTY_IMAGES): boolean {
  return a.length === b.length && a.every((image, i) => image.path === b[i].path && image.name === b[i].name)
}
export function parseDraftImages(value: unknown): readonly DraftImage[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_IMAGES) return undefined
  const rows: DraftImage[] = []
  for (const item of value as unknown[]) {
    if (!item || typeof item !== 'object' || !('path' in item) || typeof item.path !== 'string'
      || !isAbsolute(item.path) || item.path.includes('\0') || Buffer.byteLength(item.path) > 16384) return undefined
    if ('name' in item && (typeof item.name !== 'string' || /[\x00-\x1f\x7f]/.test(item.name) || item.name.length > 255)) return undefined
    rows.push({ path: item.path, ...('name' in item ? { name: item.name as string } : {}) })
  }
  return rows
}
/** Paths cross the existing submission boundary, never the displayed editor buffer. */
export function imageSubmission(text: string, images: readonly DraftImage[]): string {
  return [text, ...images.map(image => `'${image.path.replace(/'/g, "'\\''")}'`)].filter(Boolean).join('\n')
}
