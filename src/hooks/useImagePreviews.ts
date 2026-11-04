import { useEffect, useState } from 'react'
import { previewImages, type ImagePreview } from '../attachments/preview.ts'

export function useImagePreviews(text: string, cwd: string): readonly ImagePreview[] {
  const [result, setResult] = useState<{ text: string; rows: ImagePreview[] }>({ text: '', rows: [] })
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      void previewImages(text, cwd, process.env['HOME']).then((rows) => {
        if (active) setResult({ text, rows })
      })
    }, 100)
    return () => { active = false; clearTimeout(timer) }
  }, [text, cwd])
  // Never remove a range measured against an earlier buffer.
  return result.text === text ? result.rows : []
}
