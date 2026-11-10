import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { editExternal, editorCommand, selectedEditor } from '../src/terminal/external-editor.ts'
import { paintApp } from './fake-tty.ts'
const roots: string[] = []
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture(code: string): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-editor-test-')); roots.push(path)
  const file = join(path, 'editor script.cjs'); writeFileSync(file, code)
  return `"${process.execPath}" "${file}"`
}
it('parses quoted executable/args without evaluating a shell and respects editor precedence', () => {
  expect(editorCommand('"/Apps/My Editor" --wait "a b"')).toEqual(['/Apps/My Editor', '--wait', 'a b'])
  expect(editorCommand("vim '$(touch /tmp/bad)' ; echo hi")).toEqual(['vim', '$(touch /tmp/bad)', ';', 'echo', 'hi'])
  expect(editorCommand('"unclosed')).toBeUndefined()
  expect(editorCommand('')).toBeUndefined()
  expect(selectedEditor({ VISUAL: 'code --wait', EDITOR: 'vim' }, 'darwin')).toBe('code --wait')
  expect(selectedEditor({}, 'win32')).toBe('notepad.exe')
})
it('round-trips multiline UTF-8 using a private file then removes it', async () => {
  let file = ''
  const command = fixture('const fs=require(\'fs\');const f=process.argv[2];fs.writeFileSync(f,fs.readFileSync(f,\'utf8\')+\'\\n中文\');')
  const result = await editExternal('original', command, async (action) => {
    const success = await action()
    // Fixture records are verified separately below; real process and cleanup run here.
    return success
  })
  expect(result).toEqual({ kind: 'edited', text: 'original\n中文' })
  const record = join(roots[0], 'record.json')
  const command2 = fixture(`const fs=require('fs');const f=process.argv[2];fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({file:f,mode:fs.statSync(f).mode & 511}));`)
  expect((await editExternal('keep', command2)).kind).toBe('edited')
  const data = JSON.parse(readFileSync(record, 'utf8')) as { file: string; mode: number }; file = data.file
  if (process.platform !== 'win32') expect(data.mode).toBe(0o600)
  expect(() => readFileSync(file)).toThrow()
})
it('rejects nonzero exits, missing executables, invalid UTF-8 and oversized output', async () => {
  expect(await editExternal('keep', fixture('process.exitCode=1'))).toEqual({ kind: 'cancelled' })
  expect(await editExternal('keep', '/missing-editor-dsh')).toEqual({ kind: 'failed' })
  expect(await editExternal('keep', fixture("require('fs').writeFileSync(process.argv[2],Buffer.from([255]))"))).toEqual({ kind: 'failed' })
  expect(await editExternal('keep', fixture("require('fs').writeFileSync(process.argv[2],Buffer.alloc(3*1024*1024))"))).toEqual({ kind: 'invalid' })
})
it('returns external edits as one undo step without submitting; failures keep the original', async () => {
  const tty = await paintApp({ editExternally: async text => ({ kind: 'edited', text: text + '\nexternal result' }) })
  try {
    await tty.send('original'); await tty.send('\u0014')
    expect(tty.screen()).toContain('external result')
    await tty.send('\u001a'); expect(tty.screen()).not.toContain('external result'); expect(tty.screen()).toContain('original')
    await tty.send('\u0019'); expect(tty.screen()).toContain('external result')
  } finally { tty.unmount() }
  const fail = await paintApp({ editExternally: async () => ({ kind: 'cancelled' }) })
  try { await fail.send('keep this draft'); await fail.send('\u0014'); expect(fail.screen()).toContain('keep this draft'); expect(fail.screen()).toContain('original draft kept') }
  finally { fail.unmount() }
})
