import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { installationSource, readBuildIdentity, requestedProfile } from '../src/terminal/build-identity.ts'

describe('loaded build identity', () => {
  it('reports the loaded file independently of cwd and argv text', () => {
    const report = readBuildIdentity(import.meta.url, ['node', 'dsh', '--profile', 'tui-rc5'])
    const path = realpathSync(fileURLToPath(import.meta.url))
    expect(report.modulePath).toBe(path)
    expect(report.sha256).toBe(createHash('sha256').update(readFileSync(path)).digest('hex'))
    expect(report.requestedProfile).toBe('tui-rc5')
    expect(report.commit).toBeNull()
    expect(report.dirty).toBeNull()
  })
  it('recognizes installed packages on Windows and POSIX paths', () => {
    expect(installationSource(String.raw`C:\Users\test\node_modules\@qiao-qyn\dsh-tui\lib\index.js`)).toBe('installed')
    expect(installationSource('/opt/dsh/node_modules/@qiao-qyn/dsh-tui/lib/index.js')).toBe('installed')
    expect(installationSource('/work/my_node_modules/index.js')).toBe('source-or-local-build')
    expect(installationSource(undefined)).toBe('unknown')
  })
  it('does not invent missing provenance', () => {
    expect(readBuildIdentity('data:text/plain,hello', ['node', 'fixture'])).toMatchObject({
      modulePath: null, sha256: null, requestedProfile: null, installation: 'unknown',
    })
  })
  it('accepts launcher forms but stops at the argument delimiter', () => {
    expect(requestedProfile(['node', 'dsh', '--profile=tui-dev'])).toBe('tui-dev')
    expect(requestedProfile(['node', 'dsh', '--', '--profile=secret'])).toBeUndefined()
    expect(requestedProfile(['node', 'dsh', '--profile', '--help'])).toBeUndefined()
  })
})
