/**
 * The real spawner, against real subprocesses. Payloads are written as
 * `node -e "…"` rather than `echo` / `sleep` / `cat` so the same assertions hold
 * under `cmd.exe`, which has none of those with the same semantics.
 */

import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runShellCommand } from '../src/shell/shell-runner.ts'

/** A command that runs the given JS in a child Node, quoted for either shell. */
function node(source: string): string {
  return `node -e "${source.replaceAll('"', '\\"')}"`
}

const cwd = process.cwd()

describe('runShellCommand', () => {
  it('captures stdout and reports success', async () => {
    const result = await runShellCommand({ command: node('process.stdout.write(\'hi\')'), cwd })
    expect(result.output).toBe('hi')
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.truncated).toBe(false)
  })

  it('captures stderr in the same stream as stdout', async () => {
    const result = await runShellCommand({
      command: node('process.stdout.write(\'out\');process.stderr.write(\'err\')'),
      cwd,
    })
    // Both halves are present; their order is the arrival order a terminal shows.
    expect(result.output).toContain('out')
    expect(result.output).toContain('err')
  })

  it('reports a non-zero exit', async () => {
    const result = await runShellCommand({ command: node('process.exit(3)'), cwd })
    expect(result.exitCode).toBe(3)
  })

  it('runs in the directory it is given, not the process one', async () => {
    const result = await runShellCommand({
      command: node('process.stdout.write(process.cwd())'),
      cwd: tmpdir(),
    })
    // `realpath` differences (macOS `/var` → `/private/var`) make an equality
    // check brittle, so assert the thing that matters: it is not our cwd.
    expect(result.output).not.toBe(cwd)
    expect(result.output.length).toBeGreaterThan(0)
  })

  it('gives a stdin-reading command EOF instead of hanging', async () => {
    // This is the whole reason stdin is 'ignore': against Ink's raw-mode stdin
    // this command would wait for input that never comes.
    const result = await runShellCommand({
      command: node('process.stdin.on(\'end\',()=>process.stdout.write(\'eof\'));process.stdin.resume()'),
      cwd,
      timeoutMs: 5_000,
    })
    expect(result.output).toBe('eof')
    expect(result.timedOut).toBe(false)
  })

  it('kills a command that outlives its timeout', async () => {
    const result = await runShellCommand({
      command: node('setTimeout(()=>{},60000)'),
      cwd,
      timeoutMs: 200,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true)
  })

  it('kills a command when the signal aborts', async () => {
    const controller = new AbortController()
    const pending = runShellCommand({
      command: node('setTimeout(()=>{},60000)'),
      cwd,
      signal: controller.signal,
    })
    setTimeout(() => { controller.abort() }, 100)
    const result = await pending
    expect(result.aborted).toBe(true)
    expect(result.timedOut).toBe(false)
  })

  it('does not start a command when its signal was already aborted', async () => {
    const result = await runShellCommand({ command: node("process.stdout.write('should not run')"),
      cwd, signal: AbortSignal.abort() })
    expect(result.aborted).toBe(true)
    expect(result.output).toBe('')
    expect(result.exitCode).toBeNull()
  })

  it.each(['timeout', 'abort'] as const)('terminates descendants of a compound command on %s', async (reason) => {
    const controller = new AbortController()
    const start = performance.now()
    // A second command prevents the shell from replacing itself with Node.
    const pending = runShellCommand({
      command: `${node("setTimeout(()=>process.stdout.write('survived'),3000)")} && ${node("process.stdout.write('later')")}`,
      cwd, timeoutMs: reason === 'timeout' ? 300 : 5000, signal: controller.signal,
    })
    const timer = reason === 'abort' ? setTimeout(() => { controller.abort() }, 300) : undefined
    try {
      const result = await pending
      expect(performance.now() - start).toBeLessThan(2500)
      expect(result.output).not.toContain('survived')
      expect(result[reason === 'timeout' ? 'timedOut' : 'aborted']).toBe(true)
    } finally { clearTimeout(timer) }
  })

  it.skipIf(process.platform === 'win32')('force-kills a detached-output descendant after the shell has closed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-shell-tree-'))
    const script = join(directory, 'tree.cjs')
    const ready = join(directory, 'ready')
    const survived = join(directory, 'survived')
    const controller = new AbortController()
    let descendant: number | undefined
    let pending: ReturnType<typeof runShellCommand> | undefined
    try {
      await writeFile(script, `const fs = require('node:fs');
if (process.argv[2] === 'child') {
  process.on('SIGTERM', () => {});
  fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
  setTimeout(() => { fs.writeFileSync(${JSON.stringify(survived)}, 'alive'); }, 2700);
  setTimeout(() => process.exit(), 4000);
} else {
  require('node:child_process').spawn(process.execPath, [__filename, 'child'], { stdio: 'ignore' });
  setTimeout(() => {}, 5000);
}`)
      pending = runShellCommand({ command: `"${process.execPath}" "${script}"`, cwd,
        signal: controller.signal, timeoutMs: 6000 })
      // Readiness observes the child's installed signal handler, not an arbitrary sleep.
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        try { descendant = Number(await readFile(ready, 'utf8')); break } catch { await new Promise(resolve => setTimeout(resolve, 20)) }
      }
      expect(descendant).toBeGreaterThan(0)
      controller.abort()
      const result = await pending
      expect(result.aborted).toBe(true)
      await new Promise(resolve => setTimeout(resolve, 2900))
      await expect(readFile(survived, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      controller.abort()
      await pending
      if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch { /* Already terminated. */ } }
      await rm(directory, { recursive: true, force: true })
    }
  }, 10000)

  it('truncates past the byte cap without faking an exit status', async () => {
    const result = await runShellCommand({
      command: node('process.stdout.write(\'x\'.repeat(5000))'),
      cwd,
      maxBytes: 100,
    })
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThanOrEqual(100)
    // The command succeeded, and the cap must not claim otherwise.
    expect(result.exitCode).toBe(0)
  })

  it('reports a shell that cannot start rather than rejecting', async () => {
    const result = await runShellCommand({
      command: node('process.stdout.write(\'\')'),
      cwd: '/definitely/not/a/directory',
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.output.length).toBeGreaterThan(0)
  })
})
