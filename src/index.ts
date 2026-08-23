/**
 * The TUI runner Cordis plugin. It waits for the Loader to settle, creates
 * one long-lived Agent, and renders the Ink application. The Ink app drives
 * the conversation; the runner owns the process-lifetime promise.
 * @module @deepseek-ai/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, writeFileSync } from 'node:fs'
import React from 'react'
import { render as inkRender } from 'ink'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
// Empty type import carries the loader Context merge for the settlement await
// and the cordis EventMap merge for `session/event` and `agent/*`.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { appExit, service, type AppExit } from './services.ts'
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

const ALT_SCREEN_ENTER = '\u001B[?1049h\u001B[2J\u001B[H'
const ALT_SCREEN_EXIT = '\u001B[?1049l'
const CLEAR_SCREEN = '\u001B[2J\u001B[H'
/**
 * Ask the terminal to translate the wheel into cursor-key presses while the
 * alternate screen is up — xterm's "alternate scroll mode" — instead of
 * asking it to report mouse events at all.
 *
 * Full mouse tracking (`?1000h` + `?1006h`) was the first attempt and it
 * cost too much. Once the application is receiving clicks and drags, the
 * *terminal's own* selection stops working: dragging across the transcript
 * selects nothing unless a modifier is held (`Option` in iTerm2, `Fn` in
 * Terminal.app). Selecting output to paste somewhere else is not an
 * advanced gesture; it is most of what a chat log is for, and a wheel is
 * not worth it.
 *
 * Alternate scroll keeps the wheel and leaves the pointer alone: notches
 * arrive as ↑/↓, which `useMessageListScroll` scrolls a row at a time, and
 * no click is ever intercepted. A terminal that ignores `?1007` just keeps
 * its own wheel behaviour — the keyboard bindings still reach every row.
 * The hook also still understands SGR mouse reports, so a terminal
 * configured to send them anyway continues to scroll.
 */
const ALT_SCROLL_ENTER = '\u001B[?1007h'
/**
 * Turn it off again. This has to run on *every* exit path, a crash
 * included: a private mode left set outlives the process and changes how
 * the user's shell answers the wheel.
 */
const ALT_SCROLL_EXIT = '\u001B[?1007l'
const RESIZE_QUIET_MS = 120
const RESIZE_LOG = '/tmp/dsh-tui-resize.log'
const resizeDebug = process.env['DSH_TUI_DEBUG_RESIZE'] === '1'
function resizeLog(message: string): void {
  if (!resizeDebug) return
  appendFileSync(RESIZE_LOG, `${new Date().toISOString()} ${message}\n`)
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
  if (resizeDebug) writeFileSync(RESIZE_LOG, `${new Date().toISOString()} start\n`)
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
  if (!process.stdin.isTTY) {
    throw new Error(
      'needs an interactive terminal — stdin is not a TTY. Run it from a terminal, or use the dsh-headless bundle for non-interactive work.',
    )
  }
  if (!process.stdout.isTTY) {
    throw new Error(
      'needs an interactive terminal — stdout is not a TTY. Piping the UI to a file or another process is not a supported mode.',
    )
  }
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await service(ctx, 'loader')?.await()
  const agents = service(ctx, 'agents')
  const defaultModel = service(ctx, 'agentDefaultModel')
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
  const exitHook: AppExit = appExit(ctx) ?? ((code: number) => process.exit(code))

  const alternateScreen = process.stdout.isTTY
  try {
    if (alternateScreen) {
      internals.stdout.write(ALT_SCREEN_ENTER)
      internals.stdout.write(ALT_SCROLL_ENTER)
    }
    const instance = inkRender(
      React.createElement(App, { ctx, agent, exit: exitHook }),
      {
        exitOnCtrlC: false,
        patchConsole: false,
      },
    )
    let resizeTimer: NodeJS.Timeout | undefined
    const onResize = (): void => {
      resizeLog(`event columns=${process.stdout.columns ?? 0} rows=${process.stdout.rows ?? 0}`)
      if (resizeTimer !== undefined) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = undefined
        resizeLog(`settled before-clear columns=${process.stdout.columns ?? 0} rows=${process.stdout.rows ?? 0}`)
        // Use Ink's public instance API so its line-count bookkeeping and
        // the terminal screen are reset as one operation. Rendering from a
        // child hook cannot access this state and leaves the next frame
        // positioned relative to the old cursor after a resize.
        instance.clear()
        resizeLog('instance.clear done')
        internals.stdout.write(CLEAR_SCREEN)
        resizeLog('clear-screen written')
        instance.rerender(React.createElement(App, { ctx, agent, exit: exitHook }))
        resizeLog('instance.rerender called')
      }, RESIZE_QUIET_MS)
      if (typeof resizeTimer.unref === 'function') resizeTimer.unref()
    }
    if (alternateScreen) {
      // Ink installs an eager resize listener that renders immediately for
      // every SIGWINCH. Remove it so it cannot race this debounced full
      // repaint; App reads stdout.rows directly during rerender.
      process.stdout.removeAllListeners('resize')
      process.stdout.on('resize', onResize)
    }
    instance.cleanup()
    await instance.waitUntilExit()
    if (alternateScreen) {
      process.stdout.off('resize', onResize)
      if (resizeTimer !== undefined) clearTimeout(resizeTimer)
    }
    instance.unmount()
  } finally {
    // If Ink exits through an error, never leave the shell in the alternate
    // screen buffer — or in alternate scroll mode, which would leave the
    // user's wheel sending arrow keys to whatever runs next.
    if (alternateScreen) {
      internals.stdout.write(ALT_SCROLL_EXIT)
      internals.stdout.write(ALT_SCREEN_EXIT)
    }
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
    const exit = appExit(ctx)
    if (exit !== undefined) exit(1)
    else process.exit(1)
  })
}
