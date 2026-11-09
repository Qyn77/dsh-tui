import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { checkNode, commandPlan, configureCommand, install, OWNER, parseOptions, pathBlock, preflight, profileManifest, RUNTIME, run, startCommand } from '../scripts/install.mjs'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tui-install-test-')); roots.push(root)
  const artifact = join(root, 'test package.tgz'); await writeFile(artifact, 'artifact')
  return { root, artifact, options: { home: join(root, 'home with space'), profile: 'tui', ref: 'main', package: artifact, noPath: true } }
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
    expect(parseOptions(['--check', '--no-path'])).toMatchObject({ check: true, noPath: true })
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
    const logs: string[] = []
    const result = await install(options, { npmCli: '/npm/bin/npm-cli.js', run: fakeRunner(calls), log: message => logs.push(message) })
    expect(logs.join('\n')).toContain(process.platform === 'win32' ? 'Start in PowerShell 7 inside Windows Terminal:' : 'Start with:')
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

describe('environment preflight and user command', () => {
  it('rejects unsupported systems and architectures before running commands', async () => {
    const { options } = await fixture(); const calls: Call[] = []
    for (const system of [{ platform: 'freebsd' as const }, { arch: 'ia32' }, { nodeVersion: '20.0.0' }]) {
      await expect(preflight(options, { ...system, run: fakeRunner(calls), npmCli: '/npm.js', log() {} })).rejects.toThrow()
    }
    expect(calls).toHaveLength(0)
  })

  it('checks a packaged installation without requiring Git or fetching source', async () => {
    const { options } = await fixture(); const calls: Call[] = []
    await preflight(options, { run: fakeRunner(calls), npmCli: '/npm.js', log() {} })
    expect(calls.some(c => c.command === 'git')).toBe(false)
    expect(calls.some(c => c.args.includes('ping'))).toBe(true)
    expect(calls.some(c => c.args.includes('install'))).toBe(false)
  })

  it('stops on registry failure before installing packages or editing shell config', async () => {
    const { options, root } = await fixture(); const calls: Call[] = []
    const rc = join(root, '.bashrc'); await writeFile(rc, '# keep me\n')
    const execute = async (command: string, args: string[]) => {
      calls.push({ command, args })
      if (args.includes('ping')) throw new Error('private registry credential must not be logged')
      return ''
    }
    await expect(install({ ...options, noPath: false }, { run: execute, npmCli: '/npm.js', log() {}, userHome: root, platform: 'linux', env: { SHELL: '/bin/bash' } })).rejects.toThrow('npm registry is unreachable')
    expect(calls.some(c => c.args.includes('install'))).toBe(false)
    expect(await readFile(rc, 'utf8')).toBe('# keep me\n')
    expect(await readdir(join(options.home, 'profiles'))).toEqual([])
  })

  it('checks Git and source connectivity, with actionable errors', async () => {
    const { options } = await fixture(); const calls: Call[] = []
    const source = { ...options, package: undefined }
    await preflight(source, { run: fakeRunner(calls), npmCli: '/npm.js', log() {} })
    expect(calls.some(c => c.command === 'git' && c.args.includes('--version'))).toBe(true)
    expect(calls.some(c => c.command === 'git' && c.args.includes('ls-remote'))).toBe(true)
    await expect(preflight(source, { npmCli: '/npm.js', log() {}, run: async (cmd, args) => { if (cmd === 'git' && args.includes('--version')) throw new Error('missing'); return '' } })).rejects.toThrow('Git is missing')
  })

  it('refuses low disk space and non-directory homes before downloading', async () => {
    const { options, root } = await fixture(); const calls: Call[] = []
    await expect(preflight(options, { run: fakeRunner(calls), npmCli: '/npm.js', log() {}, statfs: async () => ({ bavail: 1, bsize: 4096 }) })).rejects.toThrow('Insufficient free space')
    expect(calls.some(c => c.args.includes('ping'))).toBe(false)
    const file = join(root, 'not-a-directory'); await writeFile(file, 'preserve')
    await expect(preflight({ ...options, home: file }, { run: fakeRunner([]), npmCli: '/npm.js', log() {} })).rejects.toThrow('Cannot write')
  })

  it('selects zsh, bash login and fish config without touching other shells', async () => {
    const { options, root } = await fixture()
    const enabled = { ...options, noPath: false }
    const zsh = await commandPlan(enabled, { platform: 'darwin', userHome: root, env: { SHELL: '/bin/zsh', ZDOTDIR: join(root, 'zsh') } })
    expect(zsh!.configs).toEqual([join(root, 'zsh/.zshrc')])
    await writeFile(join(root, '.bash_profile'), '# existing login\n')
    const bash = await commandPlan(enabled, { platform: 'linux', userHome: root, env: { SHELL: '/bin/bash' } })
    expect(bash!.configs).toEqual([join(root, '.bashrc'), join(root, '.bash_profile')])
    const fish = await commandPlan(enabled, { platform: 'linux', userHome: root, env: { SHELL: '/bin/fish', XDG_CONFIG_HOME: join(root, 'config') } })
    expect(fish!.configs).toEqual([join(root, 'config/fish/conf.d/dsh-tui.fish')])
    await expect(commandPlan(enabled, { platform: 'linux', userHome: root, env: { SHELL: '/bin/unknown' } })).rejects.toThrow('--no-path')
    expect(await commandPlan(options)).toBeNull()
  })

  it('preserves unrelated config, rejects malformed blocks and updates idempotently', () => {
    const original = 'export CUSTOM=value\n'
    const once = pathBlock(original, '/test/bin')
    expect(once.startsWith(original)).toBe(true)
    expect(pathBlock(once, '/test/bin')).toBe(once)
    expect(pathBlock(once, '/new/bin')).not.toContain('/test/bin')
    expect(() => pathBlock('# >>> dsh-tui PATH >>>\n', '/bin')).toThrow('Malformed')
    expect(() => pathBlock(once + once, '/bin')).toThrow('Malformed')
  })

  it.skipIf(process.platform === 'win32')('installs an executable command, backs up rc files and preserves cwd/arguments', async () => {
    const { root, options } = await fixture()
    const userHome = join(root, "user ' $(echo BAD)")
    await mkdir(userHome)
    const rc = join(userHome, '.bashrc'); const original = '# user setting\nexport CUSTOM=kept\n'
    await writeFile(rc, original)
    const plan = await commandPlan({ ...options, noPath: false }, { platform: 'linux', userHome, env: { SHELL: '/bin/bash' } })
    const launch = join(root, 'launch with spaces.mjs')
    await writeFile(launch, 'console.log(JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),custom:process.env.CUSTOM,path:process.env.PATH}))')
    await configureCommand(plan, launch)
    const firstFiles = await readdir(userHome)
    const backup = firstFiles.find(f => f.startsWith('.bashrc.dsh-tui-backup-'))!
    expect(await readFile(join(userHome, backup), 'utf8')).toBe(original)
    await configureCommand(plan, launch)
    expect(await readdir(userHome)).toEqual(firstFiles)
    const output = await run('/bin/bash', ['--noprofile', '--norc', '-c', 'source "$1"; source "$1"; dsh-tui --resume "session with spaces"', 'fixture', rc], { cwd: root, capture: true })
    const result = JSON.parse(output.trim()) as { argv: string[]; cwd: string; custom: string; path: string }
    expect(result).toMatchObject({ argv: ['--resume', 'session with spaces'], cwd: await realpath(root), custom: 'kept' })
    expect(result.path.split(':').filter((entry: string) => entry === plan!.bin)).toHaveLength(1)
  })

  it.skipIf(process.platform === 'win32')('refuses foreign commands and symlinked shell files', async () => {
    const { options, root } = await fixture()
    await mkdir(join(root, '.local/bin'), { recursive: true })
    const command = join(root, '.local/bin/dsh-tui'); await writeFile(command, '# someone else\n')
    const system = { platform: 'linux' as const, userHome: root, env: { SHELL: '/bin/bash' } }
    await expect(commandPlan({ ...options, noPath: false }, system)).rejects.toThrow('not installer-managed')
    await rm(command)
    await writeFile(join(root, 'original-rc'), '# keep')
    await symlink(join(root, 'original-rc'), join(root, '.bashrc'))
    await expect(commandPlan({ ...options, noPath: false }, system)).rejects.toThrow('linked/non-file')
    expect(await readFile(join(root, 'original-rc'), 'utf8')).toBe('# keep')
  })

  it.skipIf(process.platform !== 'darwin')('makes dsh-tui available in a fresh interactive zsh', async () => {
    const { options, root } = await fixture()
    const plan = await commandPlan({ ...options, noPath: false }, { userHome: root, env: { SHELL: '/bin/zsh', ZDOTDIR: root } })
    const launch = join(root, 'launch.mjs')
    await writeFile(launch, 'console.log("zsh-command-ready:" + process.argv.slice(2).join(","))')
    await configureCommand(plan, launch)
    const output = await run('/bin/zsh', ['-d', '-i', '-c', 'dsh-tui --resume "session with spaces"'], { env: { ...process.env, ZDOTDIR: root }, cwd: root, capture: true })
    expect(output).toContain('zsh-command-ready:--resume,session with spaces')
  })

  it('writes a Windows command and updates only user PATH through fixed PowerShell code', async () => {
    const { root, options } = await fixture()
    const plan = await commandPlan({ ...options, noPath: false }, { platform: 'win32', userHome: root })
    const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = []
    const launch = join(root, 'profile & space/launch.mjs')
    const execute: typeof run = async (_cmd, args, opts) => { calls.push({ args, env: opts?.env }); return '' }
    await configureCommand(plan, launch, { run: execute })
    await configureCommand(plan, launch, { run: execute })
    const wrapper = await readFile(plan!.command, 'utf8')
    expect(wrapper).toContain('setlocal DisableDelayedExpansion')
    expect(wrapper).toContain(`"${launch}" %*`)
    const script = Buffer.from(calls[0].args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain("CurrentUser.CreateSubKey('Environment')")
    expect(script).toContain('DoNotExpandEnvironmentNames')
    expect(script).toContain("$key.SetValue('Path'")
    expect(script).not.toContain('LocalMachine')
    expect(script).not.toContain(root)
    expect(calls[0].env!.DSH_TUI_COMMAND_BIN).toBe(plan!.bin)
    expect(calls[0].env!.DSH_TUI_PATH_BACKUP).toContain('path-backup-')
  })

  it('registers the command only after a successful verified installation', async () => {
    const { options, root } = await fixture()
    const enabled = { ...options, noPath: false }
    const system = { userHome: root, platform: 'linux' as const, env: { SHELL: '/bin/bash' }, npmCli: '/npm.js', log() {} }
    await expect(install(enabled, { ...system, run: fakeRunner([], 'native') })).rejects.toThrow('native probe failed')
    await expect(readFile(join(root, '.bashrc'))).rejects.toMatchObject({ code: 'ENOENT' })
    const result = await install(enabled, { ...system, run: fakeRunner([]) })
    expect(result.commandReady).toBe(true)
    expect(await readFile(join(root, '.local/bin/dsh-tui'), 'utf8')).toContain(result.launchPath)
  })

  it('reports post-install PATH failure while keeping the verified profile usable', async () => {
    const { options, root } = await fixture(); const messages: string[] = []
    const fake = fakeRunner([])
    const result = await install({ ...options, noPath: false }, {
      userHome: root, platform: 'win32', npmCli: '/npm.js', log: msg => messages.push(msg),
      run: async (cmd, args, opts) => {
        if (cmd === 'pwsh' && Buffer.from(args.at(-1)!, 'base64').toString('utf16le').includes('SetValue')) throw new Error('registry access changed')
        return fake(cmd, args, opts)
      },
    })
    expect(result.commandReady).toBe(false)
    expect(await readFile(result.launchPath, 'utf8')).toContain('Generated by')
    expect(messages.join('\n')).toContain('automatic dsh-tui/PATH setup did not finish')
  })
})

describe.skipIf(process.platform !== 'win32')('CMD installer entry', () => {
  async function cmdFixture(source?: string) {
    const { root } = await fixture()
    const dir = join(root, 'checkout with spaces & bang!')
    await mkdir(join(dir, 'scripts'), { recursive: true })
    const entry = join(dir, 'install.cmd')
    // Raw GitHub downloads have LF; the real checkout help test also covers CRLF.
    await writeFile(entry, (await readFile(new URL('../install.cmd', import.meta.url), 'utf8')).replaceAll('\r\n', '\n'))
    if (source !== undefined) await writeFile(join(dir, 'scripts/install.mjs'), source)
    return { root, dir, entry }
  }
  function invoke(entry: string, args = '', env = process.env) {
    return spawnSync(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', ['/d', '/v:off', '/s', '/c', `""${entry}" ${args}"`], {
      encoding: 'utf8', windowsVerbatimArguments: true, timeout: 15_000, env, cwd: dirname(entry),
    })
  }
  function withPath(path: string) {
    return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH')), PATH: path }
  }

  it('forwards quoted paths and options without requiring PowerShell', async () => {
    const { entry, root } = await cmdFixture('console.log(JSON.stringify(process.argv.slice(2)))')
    const home = join(root, 'home with spaces & bang!')
    const result = invoke(entry, `--home "${home}" --profile tui-cmd`, withPath(dirname(process.execPath)))
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual(['--home', home, '--profile', 'tui-cmd'])
  })

  it('propagates installer failure to CMD', async () => {
    const { entry } = await cmdFixture('process.exitCode = 7')
    expect(invoke(entry).status).toBe(7)
  })

  it('runs the actual installer help from a checkout', () => {
    const result = invoke(fileURLToPath(new URL('../install.cmd', import.meta.url)), '--help')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: node install.mjs')
  })

  it('fails clearly when Node is missing', async () => {
    const { entry, dir } = await cmdFixture()
    const result = invoke(entry, '', withPath(dir))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Install Node')
  })

  it('fails clearly when a standalone download has no curl', async () => {
    const { entry } = await cmdFixture()
    const result = invoke(entry, '', withPath(dirname(process.execPath)))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('curl.exe is required')
  })

  it('cleans up a failed standalone download without running partial content', async () => {
    const { entry, root } = await cmdFixture()
    const downloads = join(root, 'downloads & bang!')
    await mkdir(downloads)
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'TEMP'].includes(key.toUpperCase())))
    // Fail at a closed local proxy, without making an external network request.
    const result = invoke(entry, '--help', { ...env, TEMP: downloads, HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '' })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Failed to download the installer')
    expect(result.stdout).not.toContain('Usage: node install.mjs')
    expect(await readdir(downloads)).toEqual([])
  })

  it('runs the generated Windows command with arguments and a spaced profile path', async () => {
    const { root, options } = await fixture()
    const plan = await commandPlan({ ...options, noPath: false }, { userHome: root })
    const launch = join(root, 'launch & spaced!.mjs')
    await writeFile(launch, 'console.log(JSON.stringify(process.argv.slice(2)))')
    const commands: string[][] = []
    await configureCommand(plan, launch, { run: async (_cmd, args) => { commands.push(args); return '' } })
    const result = invoke(plan!.command, '--resume "session with spaces"')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout.trim())).toEqual(['--resume', 'session with spaces'])
    // Parse the exact registry update script without touching this user's PATH.
    const code = Buffer.from(commands[0].at(-1)!, 'base64').toString('utf16le')
    const parser = '$errors=$null; [System.Management.Automation.Language.Parser]::ParseInput($env:DSH_TEST_SCRIPT,[ref]$null,[ref]$errors) | Out-Null; if ($errors.Count) { exit 1 }'
    await expect(run('pwsh', ['-NoProfile', '-NonInteractive', '-Command', parser], { env: { ...process.env, DSH_TEST_SCRIPT: code }, capture: true })).resolves.toBe('')
  })

  it('preserves raw expandable Windows PATH entries and avoids duplicates in an isolated registry key', async () => {
    const { root, options } = await fixture()
    const plan = await commandPlan({ ...options, noPath: false }, { userHome: root })
    let code = ''; let commandEnv: NodeJS.ProcessEnv = {}
    await configureCommand(plan, join(root, 'launch.mjs'), { run: async (_cmd, args, opts) => {
      code = Buffer.from(args.at(-1)!, 'base64').toString('utf16le')
      commandEnv = opts!.env!
      return ''
    } })
    const testKey = `Software\\dsh-tui-installer-test-${randomUUID()}`
    // Use the real update logic against a disposable key; never alter user PATH
    // or broadcast environment changes from this fixture.
    code = code.replace("CreateSubKey('Environment')", `CreateSubKey('${testKey}')`).replace(/^.*::SendMessageTimeout.*\r?\n/m, '')
    const harness = `$ErrorActionPreference='Stop'
$name=$env:DSH_TEST_KEY
$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($name)
$old='%USERPROFILE%\\keep;C:\\custom'
try {
  $key.SetValue('Path',$old,[Microsoft.Win32.RegistryValueKind]::ExpandString)
  $key.Close()
  $update=[ScriptBlock]::Create($env:DSH_TEST_SCRIPT)
  & $update
  & $update
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($name)
  if ($key.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -cne ($env:DSH_TUI_COMMAND_BIN + ';' + $old)) { throw 'PATH content changed' }
  if ($key.GetValueKind('Path') -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) { throw 'PATH kind changed' }
  $backup=Get-Content -LiteralPath $env:DSH_TUI_PATH_BACKUP -Raw | ConvertFrom-Json
  if ($backup.Path -cne $old -or $backup.Kind -ne 'ExpandString') { throw 'Backup is incorrect' }
} finally { $key.Close(); [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($name,$false) }`
    await expect(run('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')], {
      env: { ...commandEnv, DSH_TEST_KEY: testKey, DSH_TEST_SCRIPT: code }, capture: true, timeout: 30_000,
    })).resolves.toBe('')
  })
})
