import { useEffect, useState } from 'react'
import { stat } from 'node:fs/promises'
import type { DraftImage } from '../attachments/draft-images.ts'
export interface DraftImagePreview { image: DraftImage; bytes?: number; missing?: true }
export function useDraftImagePreviews(images: readonly DraftImage[], refresh?: unknown): readonly DraftImagePreview[] {
  const [result, setResult] = useState<{ images: readonly DraftImage[]; rows: DraftImagePreview[] }>()
  useEffect(() => {
    let active = true
    void Promise.all(images.map(async (image): Promise<DraftImagePreview> => {
      try { const info = await stat(image.path); return info.isFile() ? { image, bytes: info.size } : { image, missing: true } }
      catch { return { image, missing: true } }
    })).then((rows) => { if (active) setResult({ images, rows }) })
    return () => { active = false }
  }, [images, refresh])
  return result?.images === images ? result.rows : images.map(image => ({ image }))
}
