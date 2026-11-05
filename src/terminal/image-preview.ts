import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

/** GUI preview is deliberately unavailable over remote or multiplexed transports. */
export function imagePreviewCommand(platform: NodeJS.Platform, local: boolean, path: string) {
  if (!local || !isAbsolute(path) || !['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff'].includes(extname(path).toLowerCase())) return undefined
  if (platform === 'darwin') return { file: '/usr/bin/open', args: ['-a', 'Preview', '--', path] }
  if (platform === 'linux') return { file: 'xdg-open', args: [path] }
  return undefined
}
export async function openImagePreview(platform: NodeJS.Platform, local: boolean, path: string): Promise<'opened' | 'unavailable' | 'missing' | 'failed'> {
  const command = imagePreviewCommand(platform, local, path)
  if (!command) return 'unavailable'
  try {
    const resolved = await realpath(path)
    if (!(await stat(resolved)).isFile()) return 'missing'
    // Recheck the target extension after resolving links; never open a disguised executable.
    const target = imagePreviewCommand(platform, local, resolved)
    if (!target) return 'unavailable'
    try { await promisify(execFile)(target.file, target.args, { timeout: 5000 }); return 'opened' }
    catch { return 'failed' }
  } catch { return 'missing' }
}
