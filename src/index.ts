/**
 * The TUI runner Cordis plugin. It waits for the Loader to settle, creates
 * one long-lived Agent, and renders the Ink application. The Ink app drives
 * the conversation; the runner owns the process-lifetime promise.
 * @module @deepseek-ai/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import React from 'react'
import { render as inkRender } from 'ink'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await
// and the cordis EventMap merge for `session/event` and `agent/*`.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { App } from './renderer.tsx'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the interactive REPL can boot. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config. Empty for v1; future surface for theme/keybinding preferences. */
export interface Config {
  /** No-op placeholder so schemastery produces a valid object. */
  __placeholder?: never
}

export const Config: z<Config> = z.object({})

/**
 * Process-facing effects of one run. Mirrors `dsh-headless` so future tests
 * can substitute captures, but the TUI keeps the live stdout/stdin here.
 */
interface TuiIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
}

/** Streams the TUI writes to; tests substitute captures. */
export const internals: TuiIo = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Report an unexpected direct-driver failure to stderr. */
function fail(io: TuiIo, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  io.stderr.write(`dsh-tui: ${message}\n`)
}

/**
 * Boot the Ink REPL against one freshly created Agent.
 * @param ctx - plugin context carrying the Agent, default model, and Session services.
 * @param io - process-facing effects.
 */
async function run(ctx: Context): Promise<void> {
  // Ink needs raw mode on stdin to read keys and a TTY on stdout to know
  // how wide to draw. AGENTS.md rule 6 and docs/SPEC.md have always
  // required the runner to refuse without both; until now that was
  // satisfied by accident, because Ink itself threw from `useInput`. It
  // no longer does: `useInput` raises the failure inside a *passive
  // effect*, and since the banner moved into `<Static>` an error thrown
  // there is swallowed (Static's layout-effect `setState` re-entrantly
  // flushes passive effects, so the throw never reaches Ink's error
  // boundary). Ink would then sit mounted forever with no input, and the
  // observable failure would be a silent hang. A precondition we own
  // cannot be swallowed, trips before a Session is created, and says
  // something more useful than Ink's stdin advice.
  if (process.stdin.isTTY !== true) {
    throw new Error(
      'needs an interactive terminal — stdin is not a TTY. Run it from a terminal, or use the dsh-headless bundle for non-interactive work.',
    )
  }
  if (process.stdout.isTTY !== true) {
    throw new Error(
      'needs an interactive terminal — stdout is not a TTY. Piping the UI to a file or another process is not a supported mode.',
    )
  }
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || defaultModel === undefined) return

  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: SessionId(`tui-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const ref: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, ref)
    },
  })

  // Ctrl-C is handled inside the App via Ink's useInput — Ink's raw mode
  // does not deliver SIGINT on Ctrl-C, so a process-level signal handler
  // is dead code. The exit function still lives here so AGENTS.md rule 7
  // ("no process.exit outside commands.ts and index.ts") is preserved:
  // the App calls it through a prop and never touches process.exit
  // itself. The dispatch logic is in `interrupt.ts`.
  const exitHook = ctx.get('appExit') ?? ((code: number) => process.exit(code))

  try {
    const { waitUntilExit, unmount, cleanup } = inkRender(
      React.createElement(App, { ctx, agent: agent as Agent, exit: exitHook }),
      {
        exitOnCtrlC: false,
        patchConsole: false,
      },
    )
    cleanup()
    await waitUntilExit()
    unmount()
  } finally {
    // no signal handler to detach
  }
}

/**
 * Mount the interactive terminal driver. The runner is an ordinary Cordis
 * plugin: it consumes the Agent/Session services and the launcher-provided
 * `ctx.appExit` (read through the global store, never via property proxy).
 * @param ctx - plugin context carrying core services and the launcher exit hook.
 * @param _config - validated empty config.
 */
export function apply(ctx: Context, _config: Config): void {
  const io: TuiIo = { stdout: internals.stdout, stderr: internals.stderr }
  void run(ctx).catch((error: unknown) => {
    fail(io, error)
    const exit = ctx.get('appExit')
    if (exit !== undefined) exit(1)
    else process.exit(1)
  })
}
