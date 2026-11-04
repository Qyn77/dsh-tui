import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from '../mcp/mcp-patch.ts'

export type ClipboardImageResult = { kind: 'image'; path: string } | { kind: 'empty' | 'unavailable' | 'failed' | 'full' }
export type PasteImage = () => Promise<ClipboardImageResult>
export const CLIPBOARD_IMAGE_LIMIT = 16 * 1024 * 1024
/** Named pasteboards are used only by integration tests, never the user's clipboard. */
export const MAC_IMAGE_SCRIPT = `ObjC.import('AppKit'); ObjC.import('Foundation');
function run(argv) {
  var board = argv.length ? $.NSPasteboard.pasteboardWithName(argv[0]) : $.NSPasteboard.generalPasteboard;
  var data = board.dataForType($.NSPasteboardTypePNG);
  if (!data || data.isNil()) {
    var tiff = board.dataForType($.NSPasteboardTypeTIFF);
    if (!tiff || tiff.isNil()) return '';
    var bitmap = $.NSBitmapImageRep.imageRepWithData(tiff);
    if (!bitmap || bitmap.isNil()) return '';
    data = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
  }
  return data && !data.isNil() ? ObjC.unwrap(data.base64EncodedStringWithOptions(0)) : '';
}`
const WINDOWS_IMAGE_SCRIPT = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; if ([Windows.Forms.Clipboard]::ContainsImage()) { $image = [Windows.Forms.Clipboard]::GetImage(); $stream = New-Object IO.MemoryStream; try { $image.Save($stream, [Drawing.Imaging.ImageFormat]::Png); [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray())) } finally { $stream.Dispose(); $image.Dispose() } }`
export interface ImageHelper { file: string; args: string[]; base64: boolean }
export function imageHelper(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ImageHelper | undefined {
  if (platform === 'darwin') return { file: '/usr/bin/osascript', args: ['-l', 'JavaScript', '-e', MAC_IMAGE_SCRIPT], base64: true }
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_IMAGE_SCRIPT], base64: true }
  if (platform === 'linux' && env['WAYLAND_DISPLAY']) return { file: 'wl-paste', args: ['--no-newline', '--type', 'image/png'], base64: false }
  if (platform === 'linux' && env['DISPLAY']) return { file: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'], base64: false }
  return undefined
}
export function pngBytes(output: Buffer, base64: boolean): Buffer | undefined {
  const text = base64 ? output.toString('utf8').trim() : ''
  if (base64 && (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))) return undefined
  const bytes = base64 ? Buffer.from(text, 'base64') : output
  if (bytes.length > CLIPBOARD_IMAGE_LIMIT || bytes.length < 8 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined
  return bytes
}
/** Cache remains referenced by saved drafts and undo history; removal from the tray does not delete it. */
export function cacheClipboardImage(bytes: Buffer, root = dshHome()): ClipboardImageResult {
  if (!pngBytes(bytes, false)) return { kind: 'failed' }
  const directory = join(root, 'tui-clipboard')
  const path = join(directory, `${createHash('sha256').update(bytes).digest('hex')}.png`)
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    try { if (lstatSync(path).isFile()) return { kind: 'image', path } } catch { /* New image. */ }
    const files = readdirSync(directory).map(name => lstatSync(join(directory, name)))
    if (files.length >= 64 || files.reduce((n, file) => n + file.size, bytes.length) > 256 * 1024 * 1024) return { kind: 'full' }
    writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
    return { kind: 'image', path }
  } catch { return { kind: 'failed' } }
  finally { try { rmSync(temp, { force: true }) } catch { /* Keep the original outcome. */ } }
}
export async function pasteClipboardImage(root = dshHome(), helper = imageHelper(process.platform, process.env)): Promise<ClipboardImageResult> {
  if (!helper) return { kind: 'unavailable' }
  try {
    const output = await new Promise<Buffer>((resolve, reject) => {
      const child = execFile(helper.file, helper.args, { encoding: 'buffer', timeout: 10000,
        maxBuffer: Math.ceil(CLIPBOARD_IMAGE_LIMIT * 4 / 3) + 1024, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout))
      child.stdin?.end()
    })
    if (output.length === 0 || (helper.base64 && output.toString('utf8').trim() === '')) return { kind: 'empty' }
    const bytes = pngBytes(output, helper.base64)
    return bytes ? cacheClipboardImage(bytes, root) : { kind: 'failed' }
  } catch (error) {
    return { kind: error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 'unavailable' : 'failed' }
  }
}
