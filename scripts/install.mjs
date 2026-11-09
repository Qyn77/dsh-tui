#!/usr/bin/env node
// Standalone installer: deliberately uses only Node built-ins.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RUNTIME = '0.2.1-rc.5'
export const OWNER = 'dsh-tui-installer-v1'
const REPOSITORY = 'https://github.com/Qyn77/dsh-tui.git'
const npmVersion = '10.9.4'
const pnpmVersion = '11.10.0'
const reserved = new Set(['web', 'headless', 'sdk', 'sdk-minimal', 'acp', 'desktop', 'node_modules'])
const marker = '.dsh-tui-install.json'
const json = value => JSON.stringify(value, null, 2) + '\n'
const exists = async path => { try { await lstat(path); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const expand = path => path === '~' ? homedir() : /^~[/\\]/.test(path) ? join(homedir(), path.slice(2)) : path

export function parseOptions(args, env = process.env) {
  const options = { home: resolve(expand(env.DSH_HOME?.trim() || join(homedir(), '.dsh'))), profile: 'tui', ref: 'main' }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') { options.help = true; continue }
    if (arg === '--no-path') { options.noPath = true; continue }
    if (arg === '--check') { options.check = true; continue }
    if (!['--home', '--profile', '--ref', '--package'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${arg}`)
    options[arg.slice(2)] = args[++i]
  }
  options.home = resolve(expand(options.home))
  if (options.package) options.package = resolve(expand(options.package))
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(options.profile) || reserved.has(options.profile.toLowerCase())) throw new Error('Use a custom profile name (1–40 letters, digits, _ or -); built-in profiles are reserved.')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(options.ref) || options.ref.includes('..')) throw new Error('Invalid Git ref.')
  if (/[\x00-\x1f\x7f]/.test(options.home)) throw new Error('The installation path contains control characters.')
  return options
}

export function startCommand(path, platform = process.platform) {
  const quoted = platform === 'win32' ? "'" + path.replaceAll("'", "''") + "'" : "'" + path.replaceAll("'", "'\\''") + "'"
  return `node ${quoted}`
}

export function checkNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  if (!Number.isFinite(major) || major < 22 || (major === 22 && minor < 19)) throw new Error(`Node ${version} is too old. Install Node >= 22.19 from https://nodejs.org/ and rerun in a new terminal.`)
}

const pathBlockStart = '# >>> dsh-tui PATH >>>'
const pathBlockEnd = '# <<< dsh-tui PATH <<<'
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const encodedPowerShell = code => ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')]

export function pathBlock(previous, bin, shell = 'bash') {
  const first = previous.indexOf(pathBlockStart)
  const last = previous.indexOf(pathBlockEnd)
  if ((first < 0) !== (last < 0) || (first >= 0 && (last < first || previous.indexOf(pathBlockStart, first + 1) >= 0 || previous.indexOf(pathBlockEnd, last + 1) >= 0))) throw new Error('Malformed dsh-tui PATH block. Repair it or use --no-path.')
  const quoted = shell === 'fish' ? "'" + bin.replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'" : shellQuote(bin)
  const body = shell === 'fish'
    ? `if not contains -- ${quoted} $PATH\n  set -gx PATH ${quoted} $PATH\nend`
    : `case ":$PATH:" in\n  *:${quoted}:*) ;;\n  *) export PATH=${quoted}:"$PATH" ;;\nesac`
  const block = `${pathBlockStart}\n${body}\n${pathBlockEnd}`
  if (first < 0) return previous + (previous.endsWith('\n') || !previous ? '' : '\n') + block + '\n'
  return previous.slice(0, first) + block + previous.slice(last + pathBlockEnd.length)
}

async function ancestor(path) {
  let current = path
  while (!(await exists(current))) {
    const parent = dirname(current)
    if (parent === current) throw new Error(`Cannot find an existing parent for ${path}.`)
    current = parent
  }
  return current
}

async function writableDirectory(path) {
  const parent = await ancestor(path)
  let probe
  try {
    probe = await mkdtemp(join(parent, '.dsh-tui-write-check-'))
  } catch { throw new Error(`Cannot write to ${path}. Choose a writable --home or fix directory permissions; do not run with sudo.`) }
  finally { if (probe) await rm(probe, { recursive: true, force: true }) }
  return parent
}

async function editableFile(path, owned = false, platform = process.platform) {
  if (await exists(path)) {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Refusing to replace linked/non-file configuration: ${path}. Use --no-path for manual setup.`)
    await access(path, constants.R_OK | constants.W_OK)
    if (owned && !(await readFile(path, 'utf8')).startsWith(platform === 'win32' ? `@echo off\r\nrem ${OWNER}\r\n` : `#!/bin/sh\n# ${OWNER}\n`)) throw new Error(`Existing command ${path} is not installer-managed. Move it yourself or use --no-path.`)
  }
  await writableDirectory(dirname(path))
}

export async function commandPlan(options, system = {}) {
  if (options.noPath) return null
  const platform = system.platform || process.platform
  const env = system.env || process.env
  const userHome = system.userHome || homedir()
  const bin = platform === 'win32' ? join(userHome, '.dsh', 'bin') : join(userHome, '.local', 'bin')
  if (/[\x00-\x1f\x7f]/.test(bin) || (platform === 'win32' ? /[;%]/.test(bin) : bin.includes(':'))) throw new Error('User command directory cannot be represented in PATH. Use --no-path.')
  const command = join(bin, platform === 'win32' ? 'dsh-tui.cmd' : 'dsh-tui')
  // The platform is injected only by tests; real installation uses this host.
  await editableFile(command, true, platform)
  const configs = []
  let shell = ''
  if (platform !== 'win32') {
    shell = basename(env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash'))
    if (shell === 'zsh') configs.push(join(env.ZDOTDIR ? resolve(env.ZDOTDIR) : userHome, '.zshrc'))
    else if (shell === 'bash') {
      configs.push(join(userHome, '.bashrc'))
      const candidates = ['.bash_profile', '.bash_login', '.profile'].map(name => join(userHome, name))
      let login = candidates[2]
      for (const candidate of candidates) if (await exists(candidate)) { login = candidate; break }
      configs.push(login)
    } else if (shell === 'fish') configs.push(join(env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(userHome, '.config'), 'fish', 'conf.d', 'dsh-tui.fish'))
    else throw new Error(`Automatic PATH setup does not support shell ${shell}. Use bash/zsh/fish or pass --no-path and configure PATH manually.`)
    for (const path of configs) {
      await editableFile(path)
      pathBlock(await exists(path) ? await readFile(path, 'utf8') : '', bin, shell)
    }
  }
  return { platform, bin, command, configs, shell }
}

export async function preflight(options, dependencies = {}) {
  checkNode(dependencies.nodeVersion || process.versions.node)
  const platform = dependencies.platform || process.platform
  const arch = dependencies.arch || process.arch
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error(`Unsupported installer platform ${platform}/${arch}. Use macOS, Linux or Windows with x64/arm64 Node.`)
  const execute = dependencies.run || run
  const npm = dependencies.npmCli || await findNpmCli()
  const log = dependencies.log || console.log
  log('[check] Checking tools, directories, disk space and dependency sources...')
  const step = async (label, task) => { try { await task() } catch { throw new Error(`Environment check failed: ${label}. No packages have been installed. Fix this and rerun.`) } }
  await step('npm cannot run; reinstall Node with npm', () => execute(process.execPath, [npm, '--version'], { capture: true, timeout: 30_000 }))
  if (!options.package) await step('Git is missing or cannot run; install Git', () => execute('git', ['--version'], { capture: true, timeout: 30_000 }))
  else if (!(await lstat(options.package)).isFile()) throw new Error('--package must point to a regular tarball file.')
  for (const path of [options.home, dependencies.tempDir || tmpdir()]) {
    const parent = await writableDirectory(path)
    const info = await (dependencies.statfs || statfs)(parent)
    if (Number(info.bavail) * Number(info.bsize) < 1024 ** 3) throw new Error(`Insufficient free space at ${path}. Free at least 1 GiB before installing (more may be needed for native builds).`)
  }
  const plan = await commandPlan(options, dependencies)
  if (platform === 'win32') {
    await step('PowerShell 7 is required for the supported Windows runtime; install it and reopen the terminal', () => execute('pwsh', encodedPowerShell('if ($PSVersionTable.PSVersion.Major -lt 7) { exit 1 }'), { capture: true, timeout: 30_000 }))
    if (plan) await step('Windows user PATH cannot be accessed for writing; use --no-path for manual setup', () => execute('pwsh', encodedPowerShell("$ErrorActionPreference='Stop'; $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$true); if ($null -ne $key) { try { if ($null -ne $key.GetValue('Path')) { $kind=$key.GetValueKind('Path'); if ($kind -ne 'String' -and $kind -ne 'ExpandString') { throw 'PATH is not a string' } } } finally { $key.Close() } } else { $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('',$true); $key.Close() }"), { capture: true, timeout: 30_000 }))
  }
  await step('npm registry is unreachable; check your npm registry, proxy, credentials and network', () => execute(process.execPath, [npm, 'ping', '--fetch-retries=0', '--fetch-timeout=15000'], { capture: true, timeout: 30_000 }))
  if (!options.package) await step('GitHub repository is unreachable; check Git proxy/network access', () => execute('git', ['ls-remote', '--exit-code', REPOSITORY, 'HEAD'], { capture: true, timeout: 30_000 }))
  log('[check] Environment checks passed. Native dependencies will also be tested before activation.')
  return plan
}

async function writeConfig(path, content, mode) {
  await mkdir(dirname(path), { recursive: true })
  const present = await exists(path)
  if (present && (await readFile(path, 'utf8')) === content) return
  if (present) await copyFile(path, `${path}.dsh-tui-backup-${randomUUID()}`, constants.COPYFILE_EXCL)
  const temp = `${path}.dsh-tui-${randomUUID()}`
  try {
    await writeFile(temp, content, { mode: mode || (present ? (await lstat(path)).mode & 0o777 : 0o600), flag: 'wx' })
    if (mode) await chmod(temp, mode)
    await rename(temp, path)
  } finally { await rm(temp, { force: true }) }
}

export async function configureCommand(plan, launchPath, dependencies = {}) {
  if (!plan) return
  const node = dependencies.node || process.execPath
  await editableFile(plan.command, true, plan.platform)
  const cmdQuote = value => '"' + value.replaceAll('%', '%%') + '"'
  const wrapper = plan.platform === 'win32'
    ? `@echo off\r\nrem ${OWNER}\r\nsetlocal DisableDelayedExpansion\r\n${cmdQuote(node)} ${cmdQuote(launchPath)} %*\r\nexit /b %errorlevel%\r\n`
    : `#!/bin/sh\n# ${OWNER}\nexec ${shellQuote(node)} ${shellQuote(launchPath)} "$@"\n`
  await writeConfig(plan.command, wrapper, 0o755)
  if (plan.platform === 'win32') {
    // User scope only. Values go through the environment, never executable source.
    const script = `$ErrorActionPreference='Stop'
$bin=$env:DSH_TUI_COMMAND_BIN
$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
$old=$key.GetValue('Path',$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$kind=if ($null -eq $old) { [Microsoft.Win32.RegistryValueKind]::ExpandString } else { $key.GetValueKind('Path') }
if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) { throw 'User PATH is not a string' }
$found=@($old -split ';' | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\\') -ieq $bin.TrimEnd('\\') })
if ($found.Count -eq 0) {
  Add-Type -Namespace DshTui -Name EnvironmentNotify -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint msg, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);'
  @{ Path = $old; Kind = $kind.ToString() } | ConvertTo-Json | Set-Content -LiteralPath $env:DSH_TUI_PATH_BACKUP -Encoding utf8
  $key.SetValue('Path', ($bin + $(if ($old) { ';' + $old } else { '' })), $kind)
  $key.Flush()
  $result=[UIntPtr]::Zero
  [DshTui.EnvironmentNotify]::SendMessageTimeout([IntPtr]65535,26,[UIntPtr]::Zero,'Environment',2,5000,[ref]$result) | Out-Null
}
} finally { $key.Close() }`
    await (dependencies.run || run)('pwsh', encodedPowerShell(script), { env: { ...process.env, DSH_TUI_COMMAND_BIN: plan.bin, DSH_TUI_PATH_BACKUP: join(plan.bin, `path-backup-${randomUUID()}.json`) }, capture: true, timeout: 30_000 })
  } else {
    for (const path of plan.configs) {
      await editableFile(path)
      const previous = await exists(path) ? await readFile(path, 'utf8') : ''
      await writeConfig(path, pathBlock(previous, plan.bin, plan.shell))
    }
  }
}

// Invoke npm's JavaScript entry directly: npm.cmd cannot be safely spawned with
// arbitrary path arguments through cmd.exe on Windows.
export async function findNpmCli(env = process.env) {
  const candidates = [env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue
    candidates.push(join(dir, 'node_modules/npm/bin/npm-cli.js'))
    try { candidates.push(await realpath(join(dir, 'npm'))) } catch { /* another PATH entry */ }
  }
  for (const path of candidates) {
    if (!path || !path.endsWith('npm-cli.js')) continue
    try { await access(path, constants.R_OK); return path } catch { /* another installation */ }
  }
  throw new Error('npm was not found beside Node or on PATH. Install Node with npm, then reopen your terminal.')
}

export function run(command, args, { cwd, env = process.env, capture = false, timeout = 900_000 } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'], windowsHide: true, detached: process.platform !== 'win32' })
    let output = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (!child.pid) return
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        killer.on('error', () => child.kill())
      } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }, timeout)
    // Captured diagnostics can contain user configuration; never echo them on failure.
    child.stdout?.on('data', data => { output = (output + data).slice(-4_000_000) })
    child.stderr?.on('data', () => {})
    child.on('error', error => { clearTimeout(timer); reject(new Error(`Could not start ${command}: ${error.code || 'spawn failed'}`)) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0 && !timedOut) resolveRun(output)
      else reject(new Error(`${command === process.execPath ? 'Node/package command' : command} ${timedOut ? 'timed out' : `failed (exit ${code})`}. Check network, proxy/registry settings, disk space and native build prerequisites. The existing profile has not been replaced.`))
    })
  })
}

export function profileManifest(previous, artifact) {
  const bundles = previous.dsh?.profile?.bundles ?? []
  if (!Array.isArray(bundles) || bundles.some(value => typeof value !== 'string')) throw new Error('Invalid existing profile bundle list; leaving it unchanged.')
  return { ...previous, name: previous.name || 'dsh-tui-profile', private: true,
    dependencies: { ...previous.dependencies, '@deepseek-ai/dsh': RUNTIME, '@deepseek-ai/dsh-base': RUNTIME, '@qiao-qyn/dsh-tui': artifact },
    dsh: { ...previous.dsh, profile: { ...previous.dsh?.profile, bundles: ['@deepseek-ai/dsh-base', '@qiao-qyn/dsh-tui', ...bundles.filter(name => !['@deepseek-ai/dsh-base', '@qiao-qyn/dsh-tui'].includes(name))] } } }
}

function launcher(home, profile) {
  return `// Generated by ${OWNER}; uses this profile's pinned launcher, not global dsh.\nimport { spawn } from 'node:child_process'\nimport { fileURLToPath } from 'node:url'\nconst child = spawn(process.execPath, [fileURLToPath(new URL('./node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url)), '--profile', ${JSON.stringify(profile)}, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, DSH_HOME: ${JSON.stringify(home)} } })\nfor (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal) })\nchild.on('error', () => { console.error('Cannot start dsh. Rerun the installer.'); process.exitCode = 1 })\nchild.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1) })\n`
}

export async function verifyProfile(profileDir, name, home, execute = run) {
  for (const packageName of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@qiao-qyn/dsh-tui']) {
    const pkg = await readJson(join(profileDir, 'node_modules', packageName, 'package.json'))
    if (pkg.version !== RUNTIME) throw new Error(`Version mismatch for ${packageName}; expected ${RUNTIME}.`)
  }
  const entry = join(profileDir, 'node_modules/@qiao-qyn/dsh-tui/lib/index.js')
  await access(entry)
  await access(join(profileDir, 'node_modules/@qiao-qyn/dsh-tui/cordis.patch.yml'))
  await execute(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(entry).href)})`], { cwd: profileDir, capture: true, timeout: 60_000 })
  const nativeProbe = `
    import { createRequire } from 'node:module';
    const require = createRequire(${JSON.stringify(join(profileDir, 'package.json'))});
    require('koffi');
    const pty = require('node-pty');
    await new Promise((done, fail) => {
      const child = pty.spawn(process.execPath, ['-e', 'process.stdout.write("dsh-native-ready")'], { cwd: ${JSON.stringify(profileDir)}, cols: 80, rows: 24 });
      let output = '';
      const timer = setTimeout(() => { child.kill(); fail(new Error('Native PTY probe timed out')); }, 10000);
      child.onData(data => { output += data; });
      child.onExit(({exitCode}) => { clearTimeout(timer); exitCode === 0 && output.includes('dsh-native-ready') ? done() : fail(new Error('Native PTY probe failed')); });
    });`
  await execute(process.execPath, ['--input-type=module', '-e', nativeProbe], { cwd: profileDir, capture: true, timeout: 30_000 })
  const config = await execute(process.execPath, [join(profileDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', name, '--dump-default-config'], { cwd: profileDir, env: { ...process.env, DSH_HOME: home }, capture: true, timeout: 60_000 })
  if (!config.includes('tui-runner')) throw new Error('Bundle verification failed: tui-runner is missing from the composed profile.')
}

export async function install(options, dependencies = {}) {
  checkNode()
  const execute = dependencies.run || run
  const log = dependencies.log || console.log
  const npm = dependencies.npmCli || await findNpmCli()
  const profiles = join(options.home, 'profiles')
  const target = join(profiles, options.profile)
  await writableDirectory(options.home)
  await mkdir(profiles, { recursive: true })
  // A lock is outside the replaceable directory. A stale lock is reported, not removed blindly.
  const lock = join(profiles, `.${options.profile}-install.lock`)
  try { await mkdir(lock) } catch (error) { if (error.code === 'EEXIST') throw new Error(`Another installer or interrupted install owns ${lock}. Confirm no installer is running before removing this lock.`); throw error }
  let scratch
  let stage
  let backup
  try {
    const previousExists = await exists(target)
    let previous = {}
    if (previousExists) {
      if ((await lstat(target)).isSymbolicLink() || !(await lstat(target)).isDirectory()) throw new Error('Refusing to replace a linked or non-directory profile.')
      let owned
      try { owned = await readJson(join(target, marker)) } catch { /* unowned */ }
      if (owned?.owner !== OWNER) throw new Error(`Existing profile ${target} is not installer-managed. Choose another --profile name; existing profiles are never adopted or overwritten.`)
      previous = await readJson(join(target, 'package.json'))
    }
    const plan = await preflight(options, { ...dependencies, run: execute, npmCli: npm, log })
    scratch = await mkdtemp(join(tmpdir(), 'dsh-tui-setup-'))
    log('[1/5] Preparing pinned package managers (no global installation)...')
    await writeFile(join(scratch, 'package.json'), json({ private: true }))
    await execute(process.execPath, [npm, 'install', '--prefix', scratch, '--ignore-scripts', '--no-audit', '--no-fund', `npm@${npmVersion}`, `pnpm@${pnpmVersion}`], { cwd: scratch })
    const npmPinned = join(scratch, 'node_modules/npm/bin/npm-cli.js')
    const pnpm = join(scratch, 'node_modules/pnpm/bin/pnpm.cjs')
    let artifact = options.package
    let commit = null
    if (!artifact) {
      log('[2/5] Fetching and building TUI source with the frozen lockfile...')
      const source = join(scratch, 'source')
      await execute('git', ['init', source], { capture: true, timeout: 30_000 })
      await execute('git', ['-C', source, 'fetch', '--depth=1', REPOSITORY, options.ref], { timeout: 180_000 })
      await execute('git', ['-C', source, 'checkout', '--detach', 'FETCH_HEAD'], { capture: true, timeout: 30_000 })
      commit = (await execute('git', ['-C', source, 'rev-parse', 'HEAD'], { capture: true, timeout: 30_000 })).trim()
      const manifest = await readJson(join(source, 'package.json'))
      if (manifest.name !== '@qiao-qyn/dsh-tui' || manifest.version !== RUNTIME || manifest.packageManager !== `pnpm@${pnpmVersion}`) throw new Error('This source revision needs a different installer/runtime. Use the installer shipped with that revision.')
      await execute(process.execPath, [pnpm, 'install', '--frozen-lockfile', '--ignore-scripts'], { cwd: source })
      await execute(process.execPath, [join(source, 'scripts/clean.mjs')], { cwd: source })
      await execute(process.execPath, [join(source, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.dts.json'], { cwd: source })
      await execute(process.execPath, [join(source, 'node_modules/tsdown/dist/run.mjs')], { cwd: source })
      const packed = JSON.parse(await execute(process.execPath, [npmPinned, 'pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: source, capture: true }))
      const filename = packed[0]?.filename
      if (typeof filename !== 'string' || /[/\\]/.test(filename) || !filename.endsWith('.tgz')) throw new Error('npm pack returned an invalid artifact path.')
      artifact = join(scratch, filename)
    }
    const hash = createHash('sha256').update(await readFile(artifact)).digest('hex')
    const id = randomUUID().slice(0, 8)
    const stageName = `${options.profile}-setup-${id}`
    stage = join(profiles, stageName)
    await mkdir(stage)
    if (previousExists) await cp(target, stage, { recursive: true, filter: path => !['node_modules', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'launch.mjs', 'cordis.yml', marker].some(name => path === join(target, name)) })
    const artifactDir = join(stage, 'artifacts')
    if (await exists(artifactDir) && (await lstat(artifactDir)).isSymbolicLink()) throw new Error('Refusing a linked artifact directory in the existing profile.')
    await mkdir(artifactDir, { recursive: true })
    const packedName = `dsh-tui-${hash.slice(0, 16)}-${id}.tgz`
    await cp(artifact, join(stage, 'artifacts', packedName))
    // Preserve user patch/env/extra dependencies; let npm resolve the three pinned dependencies afresh.
    for (const name of ['package-lock.json', 'pnpm-lock.yaml']) await rm(join(stage, name), { force: true })
    await writeFile(join(stage, 'package.json'), json(profileManifest(previous, `file:artifacts/${packedName}`)))
    log('[3/5] Installing matched launcher, base and TUI, including native dependencies...')
    await execute(process.execPath, [npmPinned, 'install', '--ignore-scripts=false', '--foreground-scripts', '--no-audit', '--no-fund'], { cwd: stage })
    log('[4/5] Checking versions, imports, native PTY and composed bundles (no model request)...')
    await verifyProfile(stage, stageName, options.home, execute)
    await writeFile(join(stage, 'launch.mjs'), launcher(options.home, options.profile))
    await writeFile(join(stage, marker), json({ owner: OWNER, runtime: RUNTIME, commit, artifactSha256: hash, installedAt: new Date().toISOString() }))
    log('[5/5] Activating the verified profile...')
    if (previousExists) {
      backup = join(profiles, `${options.profile}-backup-${id}`)
      await rename(target, backup)
    } else if (await exists(target)) throw new Error('The destination was created during installation; refusing to replace it.')
    try { await rename(stage, target) } catch (error) { if (backup) await rename(backup, target); throw error }
    stage = undefined
    const launchPath = join(target, 'launch.mjs')
    let commandReady = false
    if (plan) {
      try {
        await configureCommand(plan, launchPath, { run: execute })
        commandReady = true
        log(`Command installed: ${plan.command}\nOpen a new terminal${process.platform === 'win32' ? ' (restart Windows Terminal completely, then open PowerShell 7)' : ''} and run: dsh-tui\nExisting PATH entries and configuration are preserved; changed files have adjacent .dsh-tui-backup-* backups.`)
      } catch {
        log('The profile is installed, but automatic dsh-tui/PATH setup did not finish. Use the explicit launch command below; check configuration permissions and rerun the installer. No global dsh or credentials were changed.')
      }
    }
    const startHint = process.platform === 'win32' ? 'Start in PowerShell 7 inside Windows Terminal:' : 'Start with:'
    log(`Installed ${RUNTIME}${commit ? ` (${commit.slice(0, 8)})` : ''}. ${startHint}\n  ${startCommand(launchPath)}\nAPI key: configure DEEPSEEK_API_KEY in ${join(options.home, '.env')} (existing credentials are untouched).`)
    if (backup) log(`Previous profile preserved at ${backup}. Stop dsh before updating or restoring a backup.`)
    return { target, backup, launchPath, commit, artifactSha256: hash, commandReady }
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true })
    if (scratch) await rm(scratch, { recursive: true, force: true })
    await rm(lock, { recursive: true, force: true })
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  if (options.help) {
    console.log('dsh-tui installer (Node >= 22.19, npm; Git needed for source builds)\nUsage: node install.mjs [--profile tui] [--home PATH] [--ref main|TAG|COMMIT] [--package FILE.tgz] [--check] [--no-path]\nChecks the environment before installing. Sets up a user-level dsh-tui command and PATH after success (use --no-path to opt out). --check only runs preflight checks. No sudo, global dsh changes or credential prompts. Stop a running managed profile before updating it.')
    return
  }
  if (options.check) { await preflight(options); return }
  await install(options)
}
// Node canonicalizes import.meta.url, while argv may retain /var -> /private/var
// or a downloaded symlink. Compare real paths so a bootstrap cannot silently no-op.
const invokedPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null
if (invokedPath === await realpath(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`Installation failed: ${error.message}`); process.exitCode = 1 })
}
