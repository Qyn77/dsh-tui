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
import { installResizeOwner, type RepaintRef } from './resize.ts'
import { planResume, requestFromEnv, type SwapSession } from './resume.ts'
import { readSettings } from './settings.ts'
import { probeAppearance } from './theme.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the interactive REPL can boot. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config. */
export interface Config {
  /**
   * Continue a stored session instead of starting a new one. `'last'` picks the
   * most recently created stored session; any other value is a session id.
   * Absent means a fresh session, and `DSH_TUI_RESUME` is consulted as a
   * fallback so a resume does not require editing a patch file.
   */
  resume?: string
}

export const Config: z<Config> = z.object({
  resume: z.string(),
})

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
 * @param config - validated plugin config; `resume` selects a stored session.
 */
async function run(ctx: Context, config: Config): Promise<void> {
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
  // Asked here and read just before `render()`, with the loader await, the
  // resume plan, and agent creation in between — so the terminal's round trip
  // overlaps work that was happening anyway and costs the boot nothing. It has
  // to happen *before* Ink mounts, because after that stdin is Ink's and a
  // reply would be typed into the prompt; see `probeAppearance`.
  const detecting = probeAppearance({
    stdin: process.stdin,
    stdout: process.stdout,
    colorFgBg: process.env['COLORFGBG'],
  })

  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await service(ctx, 'loader')?.await()
  const agents = service(ctx, 'agents')
  const defaultModel = service(ctx, 'agentDefaultModel')
  if (agents === undefined || defaultModel === undefined) return

  const selection = defaultModel.currentSelection()
  // The mutable ref that `installModelSelection` reads at prompt assembly.
  // Hoisted to `run()` scope so it can be passed to the App as a prop —
  // `/model` writes it here, and the next step picks it up.
  const ref: ModelSelectionRef = { current: selection, assembled: undefined }
  // Resolved before the agent exists, because the answer decides which factory
  // call makes it. A request that cannot be honoured does not stop the boot; it
  // becomes a notice the App shows, since anything written to stderr from here
  // is erased by the alternate screen.
  const plan = await planResume(ctx, config.resume ?? requestFromEnv())
  const setup = (agentCtx: Context): void => {
    installModelSelection(agentCtx, ref)
  }
  const agentOptions = { provider: selection.provider, model: selection.model }
  // The whole handle, not just `agent`: `dispose()` is what unwinds an agent's
  // scope, and `/resume` swapping one out mid-session has to call it or every
  // switch leaks the previous agent's listeners and tools. At boot the leak was
  // invisible, because process exit collected it.
  let handle = plan.kind === 'resume'
    ? await agents.resume({ resumeSessionId: plan.id, agentOptions, setup })
    : await agents.create({
      sessionId: SessionId(`tui-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
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
    // Filled in by the App's mount effect; the resize owner borrows it to
    // force the settled frame onto the screen. See `resize.ts`.
    const repaint: RepaintRef = { current: undefined }
    // Read once, at the boundary. The App takes the language as a prop and owns
    // it as state from there, so this is the only place the process touches
    // `~/.dsh/tui.json` on the way in; `/language` writes it back out.
    const { language, theme } = readSettings()
    // `auto` is the only setting that needs the probe's answer; an explicit
    // `dark` or `light` has already decided, so it does not wait even the
    // deadline. The App still receives the measurement — under `auto` it is
    // what `/theme` reports back.
    const detected = theme === 'auto' ? await detecting : undefined
    // Assigned once Ink has mounted. `swapSession` is built before `instance`
    // exists but only ever called from a keystroke, long after.
    let redraw: () => void = () => {}
    const swapSession: SwapSession = async (request) => {
      // Refused rather than cancelled: switching away would make the running
      // turn's output unreachable, and the user asking for another session is
      // not necessarily aware one is still going.
      if (handle.agent.status === 'running') return { kind: 'busy' }
      const target = await planResume(ctx, request)
      if (target.kind === 'fresh') {
        // A boot would start a fresh session here. Mid-session that would be a
        // far worse answer than doing nothing: the user still has the session
        // they were in, and throwing it away to honour a mistyped id is not a
        // trade they asked for.
        return { kind: 'refused', notice: target.notice ?? 'Cannot resume that session.' }
      }
      // `/resume` aimed at the session already on screen. Left to run, the
      // registry would reject a second agent on a live id, and the user would
      // get a registry error where the honest answer is "you are already here".
      if (target.id === handle.agent.id) return { kind: 'current', id: target.id }
      const previous = handle
      let next
      try {
        next = await agents.resume({ resumeSessionId: target.id, agentOptions, setup })
      } catch (error) {
        // The store listed it a moment ago, so this is a load or setup failure
        // rather than a bad id. Caught rather than left to the dispatcher's
        // rejection path because only here is it known that nothing was
        // swapped: the user still has the session they were in, and the
        // message can say so instead of reading like a lost transcript.
        return {
          kind: 'refused',
          notice: `Cannot resume ${target.id}: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
      handle = next
      // Draw the new session before unwinding the old one, so no frame is ever
      // rendered against a disposed agent.
      redraw()
      // The switch has already happened and is on screen; a failure to unwind
      // the previous scope is a leak, not something to report as a failed
      // resume, and reporting it would contradict what the user is looking at.
      await previous.dispose().catch(() => {})
      return { kind: 'switched', id: target.id }
    }
    const element = (): React.ReactElement =>
      React.createElement(App, {
        ctx,
        agent: handle.agent,
        exit: exitHook,
        repaint,
        modelRef: ref,
        lang: language,
        themePref: theme,
        swapSession,
        ...detected === undefined ? {} : { appearance: detected },
        ...plan.kind === 'fresh' && plan.notice !== undefined ? { notice: plan.notice } : {},
      })
    const instance = inkRender(element(), {
      exitOnCtrlC: false,
      patchConsole: false,
    })
    redraw = () => { instance.rerender(element()) }
    // Resize repainting has exactly one owner and it lives outside React.
    // The primary screen never gets one: without the alternate screen there
    // is no frame of ours to repair.
    let detachResize: (() => void) | undefined
    if (alternateScreen) {
      detachResize = installResizeOwner({
        stdout: process.stdout,
        clear: instance.clear,
        rerender: () => { instance.rerender(element()) },
        repaint,
        log: resizeDebug ? resizeLog : undefined,
      })
    }
    instance.cleanup()
    await instance.waitUntilExit()
    detachResize?.()
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
 * @param config - validated config.
 */
export function apply(ctx: Context, config: Config): void {
  const io: TuiIo = { stdout: internals.stdout, stderr: internals.stderr }
  void run(ctx, config).catch((error: unknown) => {
    fail(io, error)
    const exit = appExit(ctx)
    if (exit !== undefined) exit(1)
    else process.exit(1)
  })
}
