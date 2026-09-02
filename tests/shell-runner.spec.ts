/**
 * The real spawner, against real subprocesses. Payloads are written as
 * `node -e "…"` rather than `echo` / `sleep` / `cat` so the same assertions hold
 * under `cmd.exe`, which has none of those with the same semantics.
 */

import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { runShellCommand } from '../src/shell-runner.ts'

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
