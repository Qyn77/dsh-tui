/**
 * Run shell escapes in the active session directory. Minimal assemblies
 * without the directory service keep the process-local cd fallback.
 * @module @qiao-qyn/dsh-tui/hooks/useShell
 */

import { useCallback, useRef, useState } from 'react'
import { homedir } from 'node:os'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Catalog } from '../core/i18n.ts'
import type { UiEntry } from '../core/types.ts'
import { SHELL_SOURCE_PLUGIN, parseCd, resolveCd, type ShellEscape } from '../shell/shell.ts'
import { runShellCommand } from '../shell/shell-runner.ts'

/** What the hook needs from the App. */
export interface UseShellDeps {
  agent: Agent
  directory?: WorkingDirectoryService
  /** The App's local appender — a `!` command produces no session event. */
  appendEntry: (entry: UiEntry) => void
  /** In-force catalog, for the one message that is ours rather than a program's. */
  strings: Catalog
}

/** The `!` runner, as the App consumes it. */
export interface ShellController {
  /** `true` while a command is in flight. The prompt goes inert. */
  running: boolean
  /** Run one parsed escape. Fire-and-forget; the entry lands when it settles. */
  run: (escape: ShellEscape) => void
  /** Kill the command in flight, if any. Wired to Ctrl-C. */
  abort: () => void
}

export function useShell({ agent, directory, appendEntry, strings }: UseShellDeps): ShellController {
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | undefined>(undefined)
  /** Where the last `cd` came from, so `cd -` has somewhere to go back to. */
  const previousRef = useRef<{ id: string; path: string } | undefined>(undefined)

  const inject = useCallback((text: string, summary: string): void => {
    agent.inject(
      createUserMessage({
        content: [{ type: 'text', text }],
        // A `notice`: a one-line account of something that happened outside the
        // conversation. The reducer skips re-projecting our own injections, so
        // this does not appear a second time as a `runtime-context` row.
        source: { kind: SHELL_SOURCE_PLUGIN, form: 'notice', summary: boundContextSummary(summary) },
      }),
    )
  }, [agent])

  const runCd = useCallback(async (escape: ShellEscape, target: NonNullable<ReturnType<typeof parseCd>>): Promise<void> => {
    const from = directory?.get(agent.session) ?? process.cwd()
    const to = resolveCd(target, {
      cwd: from,
      home: homedir(),
      ...(previousRef.current?.id === agent.id ? { previous: previousRef.current.path } : {}),
    })
    if (to === undefined) {
      appendEntry({
        kind: 'shell',
        command: escape.command,
        output: strings.shell.cdUnresolved,
        exitCode: 1,
        timedOut: false,
        truncated: false,
        injected: false,
      })
      return
    }
    let now: string
    try {
      if (directory) {
        now = await directory.set(agent, to)
      } else {
        process.chdir(to)
        now = process.cwd()
      }
    } catch (error) {
      // Node's own wording, unlocalized, exactly as a shell would relay a failed
      // `cd`. Inventing our own phrasing for `ENOTDIR` would only hide which
      // syscall refused.
      appendEntry({
        kind: 'shell',
        command: escape.command,
        output: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        timedOut: false,
        truncated: false,
        injected: false,
      })
      return
    }
    previousRef.current = { id: agent.id, path: from }
    // A successful `cd` is injected whether the user wrote `!` or `!!`. This is
    // the one place the view-only default would do damage rather than merely
    // withhold a convenience: every relative path the model uses from here on
    // means something different, and it has no other way to learn that.
    if (!directory) inject(
      `The user changed the terminal's working directory to ${now}. Resolve relative paths against it from now on.`,
      `cwd → ${now}`,
    )
    appendEntry({
      kind: 'shell',
      command: escape.command,
      output: now,
      exitCode: 0,
      timedOut: false,
      truncated: false,
      injected: true,
    })
  }, [agent, directory, appendEntry, inject, strings])

  const run = useCallback((escape: ShellEscape): void => {
    const target = parseCd(escape.command)
    if (target !== undefined) {
      setRunning(true)
      void runCd(escape, target).finally(() => setRunning(false))
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    void runShellCommand({
      command: escape.command,
      cwd: directory?.get(agent.session) ?? process.cwd(),
      signal: controller.signal,
    }).then((result) => {
      abortRef.current = undefined
      setRunning(false)
      if (escape.inject) {
        inject(
          `The user ran this command in the terminal:\n\n$ ${escape.command}\n\n`
          + `Output (exit ${result.exitCode ?? result.signal ?? 'unknown'}):\n${result.output}`,
          `$ ${escape.command}`,
        )
      }
      appendEntry({
        kind: 'shell',
        command: escape.command,
        output: result.output,
        exitCode: result.exitCode,
        ...(result.signal !== undefined ? { signal: result.signal } : {}),
        timedOut: result.timedOut,
        truncated: result.truncated,
        injected: escape.inject,
      })
    })
  }, [agent, directory, appendEntry, inject, runCd])

  const abort = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  return { running, run, abort }
}
