import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, lstat, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DRAFT_MAX_BYTES } from './drafts.ts'

export type EditorResult = { kind: 'edited'; text: string } | { kind: 'cancelled' | 'failed' | 'invalid' | 'busy' }
export type EditExternally = (text: string) => Promise<EditorResult>
/** Parse argv without shell expansion. Shell operators, substitutions and redirects are ordinary arguments. */
export function editorCommand(value: string): string[] | undefined {
  const args: string[] = []
  let word = '', quote = '', started = false
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === quote) { quote = ''; continue }
    if (!quote && (char === '"' || char === "'")) { quote = char; started = true; continue }
    if (char === '\\' && quote !== "'" && i + 1 < value.length && /[\s"'\\]/.test(value[i + 1])) { word += value[++i]; started = true; continue }
    if (!quote && /\s/.test(char)) { if (started) args.push(word); word = ''; started = false; continue }
    word += char; started = true
  }
  if (quote) return undefined
  if (started) args.push(word)
  return args.length && args[0] ? args : undefined
}
export function selectedEditor(env = process.env, platform = process.platform): string {
  return env['VISUAL']?.trim() || env['EDITOR']?.trim() || (platform === 'win32' ? 'notepad.exe' : 'vi')
}
export async function editExternal(text: string, command = selectedEditor(),
  run: (action: () => Promise<boolean>) => Promise<boolean> = action => action()): Promise<EditorResult> {
  const args = editorCommand(command)
  if (!args || Buffer.byteLength(text) > DRAFT_MAX_BYTES) return { kind: 'invalid' }
  let directory: string | undefined
  try {
    directory = await mkdtemp(join(tmpdir(), 'dsh-tui-editor-'))
    const file = join(directory, 'draft.md')
    await writeFile(file, text, { mode: 0o600, flag: 'wx' })
    const success = await run(() => new Promise<boolean>((resolve, reject) => {
      const child = spawn(args[0], [...args.slice(1), file], { stdio: 'inherit', shell: false })
      child.once('error', reject)
      child.once('exit', (code, signal) => { resolve(code === 0 && signal === null) })
    }))
    if (!success) return { kind: 'cancelled' }
    const info = await lstat(file)
    if (!info.isFile() || info.size > DRAFT_MAX_BYTES) return { kind: 'invalid' }
    const bytes = await readFile(file)
    if (bytes.length > DRAFT_MAX_BYTES) return { kind: 'invalid' }
    const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (result.includes('\0')) return { kind: 'invalid' }
    return { kind: 'edited', text: result.replace(/\r\n/g, '\n') }
  } catch { return { kind: 'failed' } }
  finally { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {}) }
}
