import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { thirdPartyLicenses } from '../scripts/third-party-licenses.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(name: string, license?: string) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-licenses-')); roots.push(root)
  const directory = join(root, 'node_modules', name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }))
  if (license) writeFileSync(join(directory, 'LICENSE'), license)
  return join(directory, 'index.js')
}
function generate(ids: string[]) {
  const emitFile = vi.fn()
  const plugin = thirdPartyLicenses()
  plugin.generateBundle.call({ emitFile }, {}, { 'index.js': { type: 'chunk', modules: Object.fromEntries(ids.map(id => [id, {}])) } })
  return emitFile.mock.calls[0][0] as { type: string; fileName: string; source: string }
}
it('ships the actual bundled package notice once without unrelated dependency notices', () => {
  const bundled = fixture('bundled', 'Copyright Fixture Author\nPermission notice')
  fixture('external', 'UNBUNDLED NOTICE')
  const asset = generate([bundled, bundled.replace('index.js', 'other.js')])
  expect(asset).toMatchObject({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt' })
  expect(asset.source).toContain('Copyright Fixture Author\nPermission notice')
  expect(asset.source.split('bundled@1.0.0')).toHaveLength(2)
  expect(asset.source).not.toContain('UNBUNDLED NOTICE')
})
it('fails the build when a newly bundled package has no notice', () => {
  expect(() => generate([fixture('missing')])).toThrow('Bundled package missing has no license notice')
})
