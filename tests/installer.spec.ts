import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { checkNode, install, OWNER, parseOptions, profileManifest, RUNTIME, run, startCommand } from '../scripts/install.mjs'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tui-install-test-')); roots.push(root)
  const artifact = join(root, 'test package.tgz'); await writeFile(artifact, 'artifact')
  return { root, artifact, options: { home: join(root, 'home with space'), profile: 'tui', ref: 'main', package: artifact } }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
type Call = { command: string; args: string[]; cwd?: string }
function fakeRunner(calls: Call[], failAt = '') {
  return async (command: string, args: string[], options: { cwd?: string } = {}) => {
    calls.push({ command, args, cwd: options.cwd })
    if (failAt === 'native' && args.some(arg => arg.includes("require('node-pty')"))) throw new Error('native probe failed')
    if (args.includes('install') && !args.includes('--prefix')) {
      if (failAt === 'install') throw new Error('simulated network failure')
      for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@qiao-qyn/dsh-tui']) {
        const dir = join(options.cwd!, 'node_modules', name)
        await mkdir(join(dir, 'lib'), { recursive: true })
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: failAt === 'version' ? '0.0.0' : RUNTIME, type: 'module' }))
        await writeFile(join(dir, 'lib/index.js'), 'export const name = "tui"')
        await writeFile(join(dir, 'cordis.patch.yml'), '[]')
      }
    }
    if (args.includes('--dump-default-config')) return failAt === 'bundle' ? '[]' : '- id: tui-runner'
    return ''
  }
}

describe('standalone installer', () => {
  it('validates platform prerequisites and prevents profile/path traversal', () => {
    expect(() => { checkNode('22.18.0') }).toThrow('too old')
    expect(() => { checkNode('20.19.0') }).toThrow('too old')
    expect(() => { checkNode('22.19.0') }).not.toThrow()
    expect(() => parseOptions(['--profile', '../x'])).toThrow()
    expect(() => parseOptions(['--profile', 'Desktop'])).toThrow()
    expect(() => parseOptions(['--ref', '--upload-pack=x'])).toThrow()
    expect(() => parseOptions(['--unknown'])).toThrow()
    expect(parseOptions(['--profile', 'tui-safe', '--home', '/tmp/some home'], {}).home).toBe(resolve('/tmp/some home'))
    expect(parseOptions([], { DSH_HOME: '   ' }).home).not.toBe(process.cwd())
  })

  it('prints shell-safe launch commands with spaces, quotes and dollar signs', async () => {
    const { root } = await fixture()
    const entry = join(root, "test ' $(echo BAD).mjs")
    await writeFile(entry, 'console.log("safe launch")')
    if (process.platform !== 'win32') expect(await run('/bin/sh', ['-c', startCommand(entry, 'darwin')], { capture: true })).toBe('safe launch\n')
    expect(startCommand("C:\\a'b\\launch.mjs", 'win32')).toBe("node 'C:\\a''b\\launch.mjs'")
  })

  it('runs the downloaded CLI when invoked through a symlinked temporary path', async () => {
    if (process.platform === 'win32') return
    const { root } = await fixture()
    const alias = join(root, 'downloaded-installer.mjs')
    await symlink(fileURLToPath(new URL('../scripts/install.mjs', import.meta.url)), alias)
    const output = await run(process.execPath, [alias, '--help'], { capture: true })
    expect(output).toContain('Usage: node install.mjs')
  })

  it('pins the matched runtime while retaining extra plugins and bundle ordering', () => {
    const old = { dependencies: { custom: '1.0.0' }, dsh: { profile: { other: true, bundles: ['custom', '@deepseek-ai/dsh-base', '@qiao-qyn/dsh-tui'] } } }
    const result = profileManifest(old, 'file:artifacts/new.tgz')
    expect(result.dependencies).toMatchObject({ custom: '1.0.0', '@deepseek-ai/dsh': RUNTIME, '@deepseek-ai/dsh-base': RUNTIME })
    expect(result.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', '@qiao-qyn/dsh-tui', 'custom'])
    expect(result.dsh.profile.other).toBe(true)
    expect(old.dsh.profile.bundles[0]).toBe('custom')
  })

  it('installs into a path with spaces, verifies before activation and runs its own launcher', async () => {
    const { options, root } = await fixture(); const calls: Call[] = []
    const result = await install(options, { npmCli: '/npm/bin/npm-cli.js', run: fakeRunner(calls), log() {} })
    expect((JSON.parse(await readFile(join(result.target, '.dsh-tui-install.json'), 'utf8')) as { owner: string }).owner).toBe(OWNER)
    expect(calls.find(c => c.args.includes('--dump-default-config'))!.args).toContain('--profile')
    expect(await readdir(join(options.home, 'profiles'))).toEqual(['tui'])
    const installed = JSON.parse(await readFile(join(result.target, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(installed.dependencies['@qiao-qyn/dsh-tui']).toMatch(/^file:artifacts\//)
    const output = join(root, 'launch-result.json')
    await writeFile(join(result.target, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(output)},JSON.stringify({argv:process.argv.slice(2),home:process.env.DSH_HOME,cwd:process.cwd()}))`)
    await run(process.execPath, [result.launchPath, '--resume', 'session with spaces'], { cwd: root, capture: true })
    expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({ argv: ['--profile', 'tui', '--resume', 'session with spaces'], home: options.home, cwd: await realpath(root) })
  })

  it('refuses an unmanaged existing profile before invoking package managers', async () => {
    const { options } = await fixture(); const target = join(options.home, 'profiles/tui')
    await mkdir(target, { recursive: true }); await writeFile(join(target, 'package.json'), '{"private":true}')
    const calls: Call[] = []
    await expect(install(options, { npmCli: '/npm.js', run: fakeRunner(calls), log() {} })).rejects.toThrow('not installer-managed')
    expect(calls).toHaveLength(0)
    expect(await readFile(join(target, 'package.json'), 'utf8')).toBe('{"private":true}')
  })

  it.each(['install', 'version', 'bundle', 'native'])('keeps the working profile intact after %s failure', async (failure) => {
    const { options } = await fixture()
    const first = await install(options, { npmCli: '/npm.js', run: fakeRunner([]), log() {} })
    await writeFile(join(first.target, 'cordis.patch.yml'), '# user patch')
    await writeFile(join(first.target, '.env'), 'PRIVATE_FIXTURE=untouched')
    const before = await readFile(join(first.target, 'package.json'), 'utf8')
    await expect(install(options, { npmCli: '/npm.js', run: fakeRunner([], failure), log() {} })).rejects.toThrow()
    expect(await readFile(join(first.target, 'package.json'), 'utf8')).toBe(before)
    expect(await readFile(join(first.target, '.env'), 'utf8')).toBe('PRIVATE_FIXTURE=untouched')
    expect(await readdir(join(options.home, 'profiles'))).toEqual(['tui'])
  })

  it('backs up an owned installation and preserves user settings on update', async () => {
    const { options } = await fixture()
    const first = await install(options, { npmCli: '/npm.js', run: fakeRunner([]), log() {} })
    await writeFile(join(first.target, 'cordis.patch.yml'), '# patch stays')
    const updated = await install(options, { npmCli: '/npm.js', run: fakeRunner([]), log() {} })
    expect(updated.backup).toMatch(/-backup-/)
    expect(await readFile(join(updated.target, 'cordis.patch.yml'), 'utf8')).toBe('# patch stays')
    expect(await readFile(join(updated.backup!, 'cordis.patch.yml'), 'utf8')).toBe('# patch stays')
  })

  it('does not follow generated-file symlinks when updating a managed profile', async () => {
    if (process.platform === 'win32') return // symlink creation may need developer mode
    const { options, root } = await fixture()
    const first = await install(options, { npmCli: '/npm.js', run: fakeRunner([]), log() {} })
    const outside = join(root, 'outside'); await writeFile(outside, 'preserve')
    await rm(join(first.target, 'launch.mjs')); await symlink(outside, join(first.target, 'launch.mjs'))
    await install(options, { npmCli: '/npm.js', run: fakeRunner([]), log() {} })
    expect(await readFile(outside, 'utf8')).toBe('preserve')
  })

  it('terminates a stuck package subprocess with an explicit failure', async () => {
    await expect(run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { capture: true, timeout: 50 })).rejects.toThrow('timed out')
  })

  it('refuses a concurrent or interrupted installer lock', async () => {
    const { options } = await fixture()
    await mkdir(join(options.home, 'profiles/.tui-install.lock'), { recursive: true })
    await expect(install(options, { npmCli: '/npm.js', run: fakeRunner([]), log() {} })).rejects.toThrow('lock')
    expect(await readdir(join(options.home, 'profiles'))).toEqual(['.tui-install.lock'])
  })
})
