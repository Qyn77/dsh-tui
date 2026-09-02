/**
 * The one place in the package that spawns a shell. Kept apart from
 * [shell.ts](./shell.ts) so the parsing rules stay testable without a
 * subprocess, and so this file's whole surface is one function to audit.
 *
 * Two constraints shape everything here:
 *
 *   - **stdin is never inherited.** The REPL runs inside the alternate screen
 *     with stdin in raw mode, owned by Ink. Handing that stdin to a child means
 *     the child and Ink both read the user's keystrokes, and a command that
 *     waits for input waits forever against a terminal that will never give it
 *     any. `'ignore'` turns that hang into an immediate EOF, which is what makes
 *     "interactive commands are not supported" a clean failure instead of a
 *     wedged UI.
 *   - **stdout and stderr are one stream.** They are concatenated in arrival
 *     order, which is what a real terminal shows. Separating them would reorder
 *     a build's errors away from the lines that explain them.
 *
 * The existing subprocess precedent in [environment.ts](./environment.ts) — an
 * explicit timeout, stdio never inherited — is followed rather than reinvented.
 * @module @deepseek-ai/dsh-tui/shell-runner
 */

import { spawn } from 'node:child_process'
import { SHELL_MAX_BYTES, SHELL_TIMEOUT_MS, clampOutput } from './shell.ts'

/** Grace period between `SIGTERM` and `SIGKILL` when killing a command. */
const KILL_GRACE_MS = 2_000

/** What {@link runShellCommand} needs. Everything is injectable for tests. */
export interface RunShellOptions {
  /** The line to run, as typed after the sigil. */
  command: string
  /** Working directory for the child. */
  cwd: string
  /** Wall-clock budget. Defaults to {@link SHELL_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Captured-output cap in UTF-8 bytes. Defaults to {@link SHELL_MAX_BYTES}. */
  maxBytes?: number
  /** Abort to kill the command — this is what Ctrl-C is wired to. */
  signal?: AbortSignal
}

/** Outcome of one `!` command. */
export interface ShellResult {
  /** Interleaved stdout and stderr, already clamped. */
  output: string
  /** Exit status, or `null` when the child died from a signal. */
  exitCode: number | null
  /** Signal that killed the child, when one did. */
  signal?: string
  /** `true` when the timeout, not the command, ended it. */
  timedOut: boolean
  /** `true` when the abort signal, not the command, ended it. */
  aborted: boolean
  /** `true` when output hit the byte cap and the rest was dropped. */
  truncated: boolean
}

/** The shell to run a line through, and the flag that means "this line". */
function shellFor(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // `/d` skips AutoRun, `/s` keeps cmd from mangling the quotes in the line,
    // `/c` runs it and exits.
    return { file: process.env['ComSpec'] ?? 'cmd.exe', args: ['/d', '/s', '/c'] }
  }
  return { file: process.env['SHELL'] ?? '/bin/sh', args: ['-c'] }
}

/**
 * Run one command and resolve with everything the transcript needs to describe
 * what happened. Never rejects: a shell that cannot even start is reported as a
 * failed result, because "spawn ENOENT" belongs in the user's transcript next to
 * the command they typed, not in an unhandled rejection.
 */
export function runShellCommand(options: RunShellOptions): Promise<ShellResult> {
  const {
    command,
    cwd,
    timeoutMs = SHELL_TIMEOUT_MS,
    maxBytes = SHELL_MAX_BYTES,
    signal,
  } = options

  return new Promise<ShellResult>((settle) => {
    const { file, args } = shellFor()
    const child = spawn(file, [...args, command], {
      cwd,
      // stdin ignored on purpose — see the module note.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const chunks: Buffer[] = []
    let bytes = 0
    let truncated = false
    let timedOut = false
    let aborted = false
    let done = false

    /**
     * Stop accumulating at the cap but let the command run to its own end. A
     * kill here would report an exit status the command never produced, so the
     * transcript would claim `exit 143` for something that succeeded. Runaway
     * output that never ends is the timeout's problem, not the cap's.
     */
    const collect = (chunk: Buffer): void => {
      if (bytes >= maxBytes) {
        truncated = true
        return
      }
      chunks.push(chunk)
      bytes += chunk.byteLength
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)

    let killTimer: NodeJS.Timeout | undefined
    const kill = (): void => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      killTimer.unref()
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)
    timer.unref()

    const onAbort = (): void => {
      aborted = true
      kill()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (exitCode: number | null, exitSignal: string | null): void => {
      // `error` and `close` can both fire (a killed child errors then closes),
      // and only the first outcome is the true one.
      if (done) return
      done = true
      clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
      const clamped = clampOutput(Buffer.concat(chunks).toString('utf8'), maxBytes)
      settle({
        output: clamped.text,
        exitCode,
        ...(exitSignal !== null ? { signal: exitSignal } : {}),
        timedOut,
        aborted,
        truncated: truncated || clamped.truncated,
      })
    }

    child.on('error', (error) => {
      chunks.push(Buffer.from(`${error.message}\n`, 'utf8'))
      finish(null, null)
    })
    child.on('close', finish)
  })
}
