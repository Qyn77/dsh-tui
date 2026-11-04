import type { EditExternally } from './terminal/external-editor.ts'
import type { PasteImage } from './attachments/clipboard-image.ts'
/**
 * The Ink root component: composes the status bar, the message list, and
 * the prompt. Owns the live projection of the agent's session, the
 * dispatch of slash commands, and the Ctrl-C interrupt path.
 * @module @qiao-qyn/dsh-tui/renderer
 */

import { sessionPickerQuery } from './commands/session-picker.ts'
import type { SessionLibrary } from './terminal/session-library.ts'
import type { DraftRepository } from './terminal/drafts.ts'
import { notificationSequence, watchNotifications, type NotificationMode } from './terminal/notifications.ts'
import { resolveMouseMode, type MousePreference } from './terminal/mouse.ts'
import type { DiagnosticRef } from './terminal/diagnostics.ts'
import { useSessionCatalog } from './hooks/useSessionCatalog.ts'
import { activityView } from './render/activity.ts'
import { Box, Static, Text, useApp, useInput, useStdin, useStdout } from 'ink'
import { readFile } from 'node:fs/promises'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ToolCallId } from '@deepseek-ai/dsh-llm'
import { entryText } from './commands/transcript.ts'
import type { HistoryPref, UiEntry } from './core/types.ts'
import { MessageList } from './components/MessageList.tsx'
import { Prompt } from './components/Prompt.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Banner } from './components/Banner.tsx'
import { ApprovalPrompt } from './components/ApprovalPrompt.tsx'
import { useRunningClock } from './hooks/useRunningClock.ts'
import { useResizeRepaint } from './hooks/useResizeRepaint.ts'
import { useMessageListScroll } from './hooks/useMessageListScroll.ts'
import { useSessionEvents } from './hooks/useSessionEvents.ts'
import { useRegistryCommands } from './hooks/useRegistryCommands.ts'
import { useApprovalRequests } from './hooks/useApprovalRequests.ts'
import { useShell } from './hooks/useShell.ts'
import { parseShellInput } from './shell/shell.ts'
import { attachImages, classifyModalities, refusalText } from './attachments/attach-runner.ts'
import { resolveSkill, skillFailureText, viewingScope } from './pickers/skill-runner.ts'
import { useSkillCommands } from './hooks/useSkillCommands.ts'
import { usePermissionPreset } from './hooks/usePermissionPreset.ts'
import { permissionRows } from './pickers/permission-picker.ts'
import { useModelCommands } from './hooks/useModelCommands.ts'
import { service } from './core/services.ts'
import { commands, dispatch } from './commands/commands.ts'
import { handleCancel, handleInterrupt } from './terminal/interrupt.ts'
import { catalog, type Lang } from './core/i18n.ts'
import { LanguageProvider } from './hooks/useStrings.tsx'
import { ThemeProvider } from './hooks/useTheme.tsx'
import type { Appearance, ThemePref } from './terminal/theme.ts'
import type { KeybindPref } from './prompt/vim.ts'
import type { SwapSession, SwapResult } from './commands/resume.ts'
import { writeSettings } from './terminal/settings.ts'
import { CLEAR_SCREEN, type RepaintRef } from './terminal/resize.ts'



/** Props for the TUI root component. */
export interface AppProps {
  editExternally?: EditExternally
  pasteImage?: PasteImage
  sessionLibrary?: SessionLibrary
  drafts?: DraftRepository
  notifications?: NotificationMode
  diagnostics?: DiagnosticRef
  forkSession?: (turn?: number) => Promise<SwapResult>
  mouse?: MousePreference
  onMousePreferenceChange?: (pref: MousePreference) => void
  ctx: Context
  agent: Agent
  /**
   * Exit hook the App calls on Ctrl-C when the REPL is idle. The
   * runner computes this so that `process.exit` stays inside
   * `index.ts` (see AGENTS.md rule 7). Same path `/exit` uses.
   */
  exit: (code: number) => void
  /**
   * The live agent's mutable model selection, owned by `index.ts`. `/model`
   * writes `current` here; `installModelSelection` snapshots it when the next
   * step enters prompt assembly, so a switch takes effect on the following
   * step rather than tearing the in-flight one. Omitted by tests that never
   * switch models — `/model` then reports that switching is unavailable.
   */
  modelRef?: ModelSelectionRef
  /**
   * Where the App publishes Ink's `useStdout().write` for the resize owner
   * in `index.ts` to borrow. That writer is the only way to make Ink emit a
   * frame it considers unchanged, and it is reachable from inside the tree
   * only. Omitted by tests that do not resize.
   */
  repaint?: RepaintRef
  /**
   * A one-off message from the boot, shown as a warn note above the first turn.
   * It exists because the run may have been *asked* to resume a stored session
   * and could not: the alternate screen erases whatever the runner writes to
   * stderr before Ink's first frame, so the only place a boot-time explanation
   * survives is the transcript itself.
   */
  notice?: string
  /**
   * The interface language this run starts in, read from `~/.dsh/tui.json` by
   * `index.ts`. `/language` changes it from here and writes the file back.
   *
   * Resolved at the boundary rather than inside the App so that the App has no
   * dependency on the developer's home directory: omitted by every test, which
   * therefore asserts English frames on any machine, whatever the person running
   * them last chose for themselves.
   */
  lang?: Lang
  /**
   * What the user last asked of `/theme`, read from `~/.dsh/tui.json` by
   * `index.ts`. Defaults to `'auto'`.
   */
  themePref?: ThemePref
  /**
   * What the user last asked of `/history` — whether a resumed session's
   * stored history is drawn — read from `~/.dsh/tui.json` by `index.ts`.
   * Defaults to `'show'`; omitted by every test, which therefore asserts the
   * transcript a resume leaves on screen.
   */
  historyPref?: HistoryPref
  /**
   * Which keymap the prompt editor starts on, read from `~/.dsh/tui.json` at
   * boot. Defaults to the readline editor.
   */
  keybinds?: KeybindPref
  /**
   * Which way the terminal's background reads, as measured by `index.ts` before
   * Ink mounted — the query has to happen while nobody else owns stdin, so it
   * cannot happen in here. Defaults to `'dark'`, which is what shipped before
   * any of this existed and is therefore what every test that omits it asserts.
   */
  appearance?: Appearance
  /**
   * Swap the agent under the App for a stored session, backing `/resume`.
   *
   * Owned by `index.ts` because everything it touches is at the boot boundary:
   * the agent registry, the mutable handle `element()` closes over, and Ink's
   * `rerender`. Optional like {@link modelRef} — a test that never resumes
   * builds an App without one, and `/resume` then reports that switching is
   * unavailable rather than throwing.
   */
  swapSession?: SwapSession
}

/**
 * The TUI root. Subscribes to the agent's session, dispatches user input
 * to the agent or to a slash command, and composes the three-pane layout.
 */
/**
 * The two contexts every framed component reads: the interface language and the
 * terminal's appearance.
 *
 * One component rather than two nested providers at each of the App's two
 * return sites. There are two because the App returns early before a model
 * selection resolves, and both returns need the same wrappers — so keeping them
 * paired here means a third context later is one edit, not three.
 */
const AppProviders: FC<{ lang: Lang; appearance: Appearance; children: ReactNode }> = (
  { lang, appearance, children },
) => (
  <LanguageProvider lang={lang}>
    <ThemeProvider appearance={appearance}>{children}</ThemeProvider>
  </LanguageProvider>
)


export const App: FC<AppProps> = ({
  ctx,
  pasteImage,
  editExternally,
  agent,
  exit,
  modelRef,
  repaint,
  diagnostics,
  drafts,
  sessionLibrary,
  notifications = 'off',
  notice,
  lang: initialLang = 'en',
  themePref: initialThemePref = 'auto',
  historyPref: initialHistoryPref = 'show',
  keybinds: initialKeybindPref = 'default',
  mouse: initialMousePref = 'auto',
  onMousePreferenceChange,
  appearance: detected = 'dark',
  swapSession,
  forkSession,
}) => {
  const { exit: closeUi } = useApp()
  const { stdout, write } = useStdout()
  const { internal_eventEmitter: inputEvents } = useStdin()
  const [mousePref, setMousePref] = useState<MousePreference>(initialMousePref)
  const setMouse = useCallback((next: MousePreference) => {
    setMousePref(next)
    onMousePreferenceChange?.(next)
    writeSettings({ mouse: next })
  }, [onMousePreferenceChange])
  useEffect(() => {
    const onInput = (chunk: string | Buffer): void => {
      const text = String(chunk)
      if (text === '\u001B[12~' || text === '\u001BOQ') {
        setMouse(resolveMouseMode(mousePref, process.env) === 'mouse' ? 'off' : 'on')
      }
    }
    inputEvents?.on('input', onInput)
    return () => { inputEvents?.off('input', onInput) }
  }, [inputEvents, mousePref, setMouse])

  const [historyPref, setHistoryPref] = useState<HistoryPref>(initialHistoryPref)
  const [lang, setLang] = useState<Lang>(initialLang)
  const strings = catalog(lang)
  const { state, fullState, historyReady, resetView, appendEntry } = useSessionEvents(ctx, agent, {
    history: historyPref, historyError: strings.output.historyReadFailed,
  })
  const [draftRequest, setDraftRequest] = useState<{ text: string; revision: number; sessionId: string }>()
  const failedDraftRef = useRef<string | undefined>()
  const restoreDraft = useCallback((text: string) => {
    setDraftRequest(previous => ({ text, revision: (previous?.revision ?? 0) + 1, sessionId: agent.id }))
  }, [agent.id])
  const draftChannel = useMemo(() => drafts?.open(agent.id), [drafts, agent.id])
  const onDraftFailure = useCallback(() => {
    appendEntry({ kind: 'note', tone: 'warn', text: strings.drafts.failed })
  }, [appendEntry, strings])
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false)
  const [libraryRevision, setLibraryRevision] = useState(0)
  const onLibraryChange = useCallback(() => { setLibraryRevision(current => current + 1) }, [])
  const sessionCommands = useSessionCatalog(ctx, agent, sessionPickerOpen, { library: sessionLibrary, revision: libraryRevision, lang })
  const onPromptValue = useCallback((value: string) => {
    setSessionPickerOpen(sessionPickerQuery(value) !== undefined)
  }, [])
  useLayoutEffect(() => {
    if (!diagnostics) return
    diagnostics.current = (entry) => {
      appendEntry({ kind: 'note', tone: entry.level === 'error' ? 'error' : 'warn',
        text: entry.text + (entry.truncated ? `\n${strings.diagnostics.details(entry.path)}` : '') })
    }
    return () => { diagnostics.current = undefined }
  }, [diagnostics, appendEntry, strings])
  const registryRows = useRegistryCommands(ctx, agent)
  const permissionPreset = usePermissionPreset(ctx, agent)
  const approvals = useApprovalRequests(ctx, agent)
  // Appended once, in an effect rather than as a seeded entry, because the view
  // is seeded by replaying the session's durable log and a boot notice is not
  // part of it — writing it into the reducer's seed would put a line in the
  // transcript that no session event stands behind. A ref, not a dependency
  // list: the notice is one thing that happened, not a value to track.
  const noticeShown = useRef(false)
  useEffect(() => {
    if (notice === undefined || noticeShown.current) return
    noticeShown.current = true
    appendEntry({ kind: 'note', text: notice, tone: 'warn' })
  }, [notice, appendEntry])
  // The selection has to be state, not a `useMemo` over `ctx`: `/model`
  // mutates it mid-session and the StatusBar has to follow. A memo keyed on
  // `ctx` reads once per mount and would leave the header naming the model
  // the session started with, which is worse than not showing one at all.
  const [selection, setSelection] = useState(
    () => service(ctx, 'agentDefaultModel')?.currentSelection(),
  )
  const refreshSelection = useCallback(() => {
    setSelection(service(ctx, 'agentDefaultModel')?.currentSelection())
  }, [ctx])
  // Skills no longer ride along in the `/` palette: they feed the `/skill `
  // picker as a separate prop. Shadowing therefore can't happen in
  // `filterCommands` anymore, so both higher layers' names are claimed here.
  const claimedCommands = useMemo(
    () => [...commands(lang), ...registryRows],
    [lang, registryRows],
  )
  const directory = service(ctx, 'workingDirectory')
  const cwd = directory?.get(agent.session) ?? process.cwd()
  const skillRowsForPicker = useSkillCommands(ctx, agent, claimedCommands, cwd)
  // Presets for the `/permission ` picker. Same projection value as the
  // StatusBar chip: no service mounted means an empty list, which means no
  // picker and the plugin command's own bare-command answer stays reachable.
  const permissionRowsForPicker = useMemo(
    () => permissionPreset === undefined ? [] : permissionRows(permissionPreset),
    [permissionPreset],
  )
  // The current provider's catalogue for the `/model ` picker. Async like the
  // skill catalog, scoped like the selection: no llm service or no selection
  // means an empty list, which means no picker.
  const modelRowsForPicker = useModelCommands(ctx, selection)
  // `!` escapes. Declared here because both the interrupt handler and the
  // submit handler need it, and it is the owner of the working directory.
  const shell = useShell({ agent, directory, appendEntry, strings })
  /**
   * Switch the interface language: repaint now, persist for the next launch.
   *
   * The order is deliberate. `setLang` is what the user watches happen, and it
   * cannot fail; the file write can (a read-only home, a full disk), and its
   * failure is reported by `writeSettings` returning `false` rather than by
   * throwing. That `false` is deliberately dropped: refusing the switch the user
   * just made because the *next* launch cannot remember it would trade a working
   * session for a durability guarantee nobody asked for.
   */
  const setLanguage = useCallback((next: Lang) => {
    setLang(next)
    writeSettings({ language: next })
  }, [])
  // What the user asked for, and what that resolves to. Two values rather than
  // one because `/theme` has to be able to say "auto, which reads as light" —
  // the preference and the appearance are different facts, and under `auto`
  // only the second one is visible on screen.
  const [themePref, setThemePref] = useState<ThemePref>(initialThemePref)
  const appearance: Appearance = themePref === 'auto' ? detected : themePref
  /** Switch the assumed background, on the same terms as {@link setLanguage}. */
  const setTheme = useCallback((next: ThemePref) => {
    setThemePref(next)
    writeSettings({ theme: next })
  }, [])
  /**
   * Switch whether resumed history is drawn, on the same terms as
   * {@link setTheme}: the re-seed the preference triggers repaints the
   * transcript this render, and the file write carries the choice to the next
   * launch — including a `DSH_TUI_RESUME` boot, which is the other moment the
   * preference decides what is on screen.
   */
  const setHistory = useCallback((next: HistoryPref) => {
    setHistoryPref(next)
    writeSettings({ history: next })
  }, [])
  /**
   * Switch the prompt editor's keymap, on the same terms as {@link setTheme}.
   * Persisted for a stronger reason than the theme is: a modal editor you have
   * to re-enable every launch is one nobody would keep using.
   */
  const [keybindPref, setKeybindPref] = useState<KeybindPref>(initialKeybindPref)
  const setKeybinds = useCallback((next: KeybindPref) => {
    setKeybindPref(next)
    writeSettings({ keybinds: next })
  }, [])
  /**
   * Write a control sequence to the terminal, for `/copy`.
   *
   * `write` rather than `stdout.write`, for the Ctrl-L reason a few handlers
   * down: Ink's writer clears log-update's frame, emits the bytes, and re-emits
   * the cached frame unconditionally. An OSC 52 sequence is invisible and moves
   * no cursor, so a raw write would *usually* be harmless — but a terminal that
   * does not recognise the sequence prints its tail as text, and this is the
   * variant where that debris is erased on the spot rather than sitting on
   * screen until the next frame happens to differ.
   */
  const emit = useCallback((sequence: string) => {
    write(sequence)
  }, [write])
  const [notificationMode, setNotificationPref] = useState(notifications)
  const setNotificationMode = useCallback((mode: NotificationMode) => {
    setNotificationPref(mode)
    writeSettings({ notifications: mode })
  }, [])
  const notify = useCallback((title: string) => {
    const sequence = notificationSequence(notificationMode, title)
    if (sequence) emit(sequence)
  }, [notificationMode, emit])
  useEffect(() => watchNotifications(ctx, agent, notify, strings), [ctx, agent, notify, strings])
  // The animated "thinking" indicator. One interval per status
  // transition; both the StatusBar (right-side) and the Prompt
  // (placeholder) read from the same frame index so the spinner
  // glyph is in lock-step on screen.
  const { spinnerFrame, elapsedSeconds } = useRunningClock(state.status === 'running', state.tasks?.at(-1)?.startedAt)

  // The live status, readable after an `await`. Attaching an image reads files
  // and commits them to the store before the message can be built, and the
  // steer-or-follow-up decision has to be made against the status at *send*
  // time — the closure's captured `state` is from the render that handled the
  // keystroke, and a turn that started while the bytes were being read would
  // otherwise get a follow-up where steering was meant.
  const statusRef = useRef(state.status)
  statusRef.current = state.status

  // Real TTY resize is coordinated by index.ts through Ink's render
  // instance. Keep the hook for non-TTY test streams only.
  useResizeRepaint()

  // Hand the resize owner Ink's own stdout writer. It clears log-update's
  // frame, writes what it is given, and then re-emits Ink's cached frame
  // whether or not Ink thinks it changed — which is the only way a settled
  // resize that produced an identical frame still ends up on screen. See
  // `resize.ts` for why that case is common rather than exotic.
  useEffect(() => {
    if (repaint === undefined) return
    repaint.current = write
    return () => {
      repaint.current = undefined
    }
  }, [repaint, write])

  // Ink hands every keystroke to every `useInput` handler and offers no way
  // to stop one from propagating, so ↑/↓ can only have one meaning at a
  // time and someone who can see both consumers has to pick it. That is
  // here: the Prompt reports when it needs the arrows for its own caret
  // (multi-row buffer, or the slash palette is open) and the log's scroll
  // hook stands down for exactly those two keys. PageUp/PageDown and
  // Ctrl-B/F/U/D never move, so the whole log always stays reachable.
  const [promptClaimsArrows, setPromptClaimsArrows] = useState(false)
  // Whether the prompt holds a half-written line. Ctrl-U and Ctrl-C both
  // belong to it while this is set — see `Prompt.onFilledChange`.
  const [promptFilled, setPromptFilled] = useState(false)
  // Whether the prompt's palette or file picker is open and owns Esc. Only a
  // concern because the prompt now takes keys during a running turn, which is
  // exactly when the App's Esc means "cancel" — see `Prompt.onEscClaimChange`.
  const [promptClaimsEsc, setPromptClaimsEsc] = useState(false)
  // Rows the prompt's floating list is taking, so the banner can give way to
  // it. Nothing about input this time: it is a layout negotiation of the same
  // shape as the three above, because the banner and the palette sit at
  // opposite ends of a frame neither of them can measure alone — see
  // `Prompt.onOverlayRowsChange` and `bannerRowBudget`.
  const [promptOverlayRows, setPromptOverlayRows] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>()
  const [searchMatches, setSearchMatches] = useState<number[]>([])
  const [browseFull, setBrowseFull] = useState(false)
  const [inspection, setInspection] = useState<UiEntry | undefined>()
  const [inspectionIndex, setInspectionIndex] = useState(0)
  const [jumpTarget, setJumpTarget] = useState<UiEntry | undefined>()
  const [expandedTasks, setExpandedTasks] = useState<ReadonlySet<number>>(new Set())
  const setActivity = useCallback((value: number | 'all' | 'none') => {
    setExpandedTasks((previous) => {
      if (value === 'none') return new Set()
      if (value === 'all') return new Set(state.tasks?.map(task => task.turn))
      const next = new Set(previous)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }, [state.tasks])
  useEffect(() => { setExpandedTasks(new Set()) }, [agent.session])
  const transcript = useMemo(() => inspection ? {
    ...state, entries: [{ kind: 'command' as const,
      input: strings.transcript.inspect(inspectionIndex + 1), text: entryText(inspection), failed: false }],
  } : activityView(state, expandedTasks), [state, expandedTasks, inspection, inspectionIndex, strings])
  const inspectEntry = useCallback((index: number) => {
    setSelectedIndex(index)
    setInspection(state.entries[index])
    setInspectionIndex(index)
    setJumpTarget(undefined)
  }, [state.entries])
  const jumpEntry = useCallback((index: number) => {
    setBrowseFull(true)
    setSelectedIndex(index)
    setInspection(undefined)
    setExpandedTasks(new Set(state.tasks?.map(task => task.turn)))
    setJumpTarget(state.entries[index])
  }, [state.entries, state.tasks])
  useEffect(() => {
    setInspection(undefined)
    setJumpTarget(undefined)
    setBrowseFull(false)
    setSelectedIndex(undefined)
    setSearchMatches([])
    setDraftRequest(undefined)
    failedDraftRef.current = undefined
  }, [agent.session])

  // An approval request names the call it is about but not what the call would
  // do; the arguments are in the entry the App already streamed. Searching from
  // the newest end because the question is always about the newest call — a
  // linear scan is right here and a `Map` would be a second copy of the log to
  // keep correct.
  const argsForCall = useCallback((callId: ToolCallId): string | undefined => {
    for (let i = state.entries.length - 1; i >= 0; i -= 1) {
      const entry = state.entries[i]
      if (entry.kind === 'tool') {
        if (entry.callId === callId) return entry.args
        const nested = entry.subCalls?.find(call => call.subCallId === callId)
        if (nested) return nested.args
      }
    }
    return undefined
  }, [state.entries])
  const diffsForCall = useCallback((name: string, raw: string | undefined) => {
    if (!raw) return []
    try {
      const view = service(ctx, 'tools')?.get(name, agent)?.presentCall?.(JSON.parse(raw))
      return view?.card === 'diff' ? view.diffs : []
    } catch { return [] }
  }, [ctx, agent])
  // Ctrl-C on an empty line at idle asks once before closing the session.
  // The flag disarms on any other keystroke rather than on a timer: a timer
  // would make the outcome of a keypress depend on how long ago the last one
  // was, which is the property that makes accidental exits accidental.
  const [exitArmed, setExitArmed] = useState(false)

  // Scroll position for the conversation viewport, in rows above the newest
  // row. It lives here rather than inside the MessageList because the
  // "scrolled into history" hint is a sibling of the list, and because the
  // key bindings belong at the root next to the Ctrl-C handler.
  const pendingTurns = agent.inbox?.nextTurn.length ?? 0
  const pendingSteps = agent.inbox?.nextStep.length ?? 0
  const scroll = useMessageListScroll({
    arrowsScroll: !promptClaimsArrows,
    ctrlUScrolls: !promptFilled,
  })


  // Ink's frame eraser is cursor-relative, so a terminal that rewraps the
  // rows already on screen when the window narrows leaves debris behind
  // that no width arithmetic can prevent. Once a resize settles, throw the
  // screen away and let Ink lay the frame down again.

  const clearView = useCallback(() => {
    resetView()
    setSelectedIndex(undefined)
    setSearchMatches([])
    setBrowseFull(false)
    setJumpTarget(undefined)
    setInspection(undefined)
  }, [resetView])

  // Ink's raw mode delivers Ctrl-C as a keystroke (input 'c' with
  // key.ctrl), not as a SIGINT signal. The Prompt's useInput also sees
  // this keystroke and would otherwise append 'c' to the buffer; the
  // Prompt handles that on its side, and the App handles the interrupt
  // here. This runs even when the prompt is "inactive" (a shell is running,
  // an approval is waiting) so the user can always cancel.
  useInput((input, key) => {
    if (inspection && key.escape) { setInspection(undefined); return }
    if (key.ctrl && input === 'c') {
      handleInterrupt({
        agent,
        closeUi,
        exit,
        shellRunning: shell.running,
        abortShell: shell.abort,
        promptFilled,
        exitArmed,
        armExit: () => { setExitArmed(true) },
      })
      return
    }
    // Any other key means the user is still working, so a previously armed
    // exit is stale. Disarming here rather than on a timer keeps the rule
    // legible: the second press must be the *next* press.
    if (exitArmed) setExitArmed(false)
    // Esc stops the work and never closes the session. It is deliberately
    // not routed through `handleInterrupt`: reaching that function's exit
    // branch from Esc is the exact accident this binding exists to avoid.
    //
    // Approval questions outrank it. A tool asks for permission *during* a
    // turn, so `ApprovalPrompt` — which binds Esc to "deny" — is active at
    // exactly the moment the agent is running. Without this guard one press
    // would deny the tool and cancel the whole turn, which is two layers
    // acting on one keystroke and the thing SPEC §1.6 forbids. Denying is
    // also the narrower reading: the user rejected a command, not the work.
    //
    // The prompt's palette and file picker outrank it for the same reason,
    // and they are live during a turn now that the box takes steering input.
    if (key.escape) {
      if (approvals.pending.length > 0 || promptClaimsEsc) return
      handleCancel({
        agent,
        closeUi,
        exit,
        shellRunning: shell.running,
        abortShell: shell.abort,
      })
      return
    }
    // Ctrl-L — throw the screen away and lay the frame down again. Not a
    // state change: the conversation, the scroll offset, and the prompt
    // buffer are all untouched, because the thing being repaired is the
    // terminal's pixels rather than anything the app believes.
    //
    // `write` is Ink's own writer, and using it rather than `stdout.write`
    // is the whole trick. It clears log-update's frame, emits our escape,
    // and then re-emits Ink's cached frame *unconditionally* — where an
    // ordinary render would be dropped, since Ink skips any frame identical
    // to the one it last wrote (`resize.ts`) and a redraw request is by
    // definition asking for the identical frame. A raw `stdout.write` would
    // clear the screen and leave it blank until the next keystroke.
    //
    // The Static banner scrolls away with everything else. That is the same
    // bargain a settled resize already makes, and `/clear` prints a new one.
    if (key.ctrl && input === 'l') write(CLEAR_SCREEN)
  })

  /**
   * Switch the live agent's model. Writes the mutable selection ref that
   * `installModelSelection` reads at prompt assembly, then persists the choice
   * as the default for future sessions.
   *
   * The two halves have different horizons. The ref write is what the *current*
   * session obeys: `installModelSelection` snapshots it at the next step, so the
   * switch lands without tearing the in-flight one. `saveSelection` writes the
   * choice through the `settings` provider dsh-base mounts (`dsh-settings-file`),
   * which is what makes it the default the next session starts with. Neither
   * substitutes for the other, so both run.
   */
  const setModel = useCallback(
    async (provider: string, model: string) => {
      if (modelRef !== undefined) modelRef.current = { provider, model }
      await service(ctx, 'agentDefaultModel')?.saveSelection({ provider, model })
    },
    [ctx, modelRef],
  )

  /**
   * Commit any images the submitted line names, and hand back what is left.
   *
   * Both services are read through `ctx.get` at call time rather than injected:
   * `tui-runner` declares neither in its `inject`, because cordis `inject` is
   * all-required and naming a service no leaf is obliged to mount would keep
   * the whole REPL from loading. `attachments` in particular is a base-layer
   * fact this package must not depend on — a bundle without it still runs, and
   * says so on the one line that tries to use it.
   *
   * The capability probe is a function so it costs a provider round-trip only
   * when there is something to attach; `attachImages` calls it after it has
   * found a candidate and never for an ordinary message.
   */
  const attach = useCallback(
    (text: string) => attachImages(text, {
      cwd,
      home: process.env['HOME'],
      store: service(ctx, 'attachments'),
      readFile: path => readFile(path),
      imageSupport: async () => {
        const model = selection?.model ?? ''
        const llm = service(ctx, 'llm')
        if (llm === undefined || selection === undefined) return { support: 'unknown', model }
        try {
          const models = await llm.listModels(selection.provider)
          const found = models.find(m => m.id === selection.model)
          return { support: classifyModalities(found?.inputModalities), model }
        } catch {
          // A listing that fails says nothing about the route's capabilities,
          // and refusing the attachment on a failed *probe* would turn a
          // provider hiccup into a lost image. Let the request be the judge.
          return { support: 'unknown', model }
        }
      },
    }),
    [ctx, selection, cwd],
  )

  /**
   * Run a `/name` the command surface did not claim as a skill invocation.
   *
   * Two messages, in this order, because the order is mechanical rather than
   * stylistic: `agent.inject` queues context *without waking the driver* and a
   * pre-step that has already claimed its batch will miss a late arrival, so
   * the body has to be pending before anything wakes the turn. The follow-up
   * carries the user's own words and is what starts it.
   *
   * A name nothing resolves to falls back to the ordinary unknown-command row,
   * so the skill layer being empty or unmounted looks exactly like it did
   * before skills existed.
   */
  const runSkill = useCallback(
    async (input: string) => {
      const outcome = await resolveSkill(input, {
        skills: service(ctx, 'skills'),
        cwd,
        scope: viewingScope(agent),
      })
      if (outcome.kind === 'invoked') {
        agent.inject(outcome.context)
        agent.followup(outcome.prompt)
        return
      }
      if (outcome.kind === 'failed') {
        appendEntry({ kind: 'note', text: skillFailureText(outcome.name, strings), tone: 'warn' })
        return
      }
      appendEntry({
        kind: 'command',
        input,
        text: strings.output.unknownCommand,
        failed: true,
      })
    },
    [ctx, agent, appendEntry, strings, cwd],
  )

  const activeAgent = useRef(agent)
  activeAgent.current = agent
  const deliverInput = useCallback(async (text: string, queued = false) => {
    const attached = await attach(text)
    for (const refusal of attached.refusals) {
      appendEntry({ kind: 'note', text: refusalText(refusal, strings), tone: 'warn' })
    }
    // A line that was *only* an unattachable path leaves nothing to send.
    // The refusal above is the whole report; an empty message would reach
    // the model as a turn with no content.
    if (attached.text === '' && attached.refs.length === 0) {
      if (queued) throw new Error(strings.queue.notSubmitted)
      return
    }
    const message = createUserMessage({
      content: [
        ...attached.refs.map(ref => ({ type: 'image' as const, attachment: ref })),
        ...(attached.text === '' ? [] : [{ type: 'text' as const, text: attached.text }]),
      ],
      source: { kind: 'user' },
    })
    if (activeAgent.current !== agent) throw new Error(strings.queue.sessionChanged)
    if (!queued && statusRef.current === 'running') agent.steer(message)
    else agent.followup(message)
    failedDraftRef.current = undefined
  }, [agent, attach, appendEntry, strings, statusRef])

  const onSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      const escape = parseShellInput(trimmed)
      if (escape !== undefined) {
        // Both refusals are one-line notes rather than shell rows: nothing ran,
        // so there is no command and no output to show.
        if (escape.command === '') {
          appendEntry({ kind: 'note', text: strings.shell.usage, tone: 'warn' })
        } else if (shell.running) {
          appendEntry({ kind: 'note', text: strings.shell.busy, tone: 'warn' })
        } else {
          shell.run(escape)
        }
        return
      }
      if (trimmed.startsWith('/')) {
        // Commands are refused mid-turn rather than queued. The refusal is
        // coarse on purpose: `/clear`, `/resume` and `/model` reach into the
        // session the running turn is writing to, plugin-registered commands
        // can do anything at all, and nothing in the registry says which is
        // which. One rule with no unknowns beats a per-command allowlist that
        // is wrong the first time a plugin adds a row.
        if (state.status === 'running' && !['/activity', '/mouse', '/notify', '/queue', '/changes', '/search', '/jump', '/inspect', '/copy', '/export'].includes(trimmed.split(/\s+/)[0])) {
          appendEntry({ kind: 'command', input: trimmed, text: strings.output.busyCommand, failed: true })
          return
        }
        // `dispatch` is async (model listing and context resolution both need
        // provider I/O). Ink ignores a handler's return value, so the promise
        // is driven here and its result appended when it settles — the prompt
        // stays responsive while a provider call is in flight.
        void dispatch(trimmed, {
          ctx,
          agent,
          closeUi,
          resetView: clearView,
          setModel,
          refreshSelection,
          setLanguage,
          lang,
          setTheme,
          themePref,
          setKeybinds,
          keybindPref,
          setActivity,
          restoreDraft,
          failedDraft: failedDraftRef.current,
          selectedIndex,
          searchMatches,
          setSearchMatches,
          inspectEntry,
          jumpEntry,
          cwd,
          exportState: fullState,
          historyReady,
          sessionLibrary, onLibraryChange,
          enqueueText: text => deliverInput(text, true).catch((error: unknown) => {
            if (activeAgent.current === agent) { failedDraftRef.current = text; restoreDraft(text) }
            throw error
          }),
          notificationMode, setNotificationMode, testNotification: () => { notify(strings.notify.test) },
          mousePref,
          setMouse,
          setHistory,
          historyPref,
          appearance,
          setVerbose: scroll.setExpanded,
          verbose: scroll.expanded,
          emit,
          swapSession,
          forkSession,
          state,
        }).then((result) => {
          // Command output goes into the log, not to stderr. Inside the
          // alternate screen a stderr write lands on the same rows Ink is
          // driving, so it is erased by the next frame or wedged into one —
          // which made `/help` and `/status` print nothing readable at all.
          if (result.kind === 'handled' && result.message !== undefined) {
            const entry: UiEntry = {
              kind: 'command', input: trimmed, text: result.message, failed: result.failed === true,
            }
            appendEntry(entry)
            setBrowseFull(true)
            setJumpTarget(entry)
          } else if (result.kind === 'unknown') {
            // Skills are the last layer of the `/` surface, tried only once
            // both the built-in table and the plugin registry have declined
            // the name. That ordering is the precedence rule (`skills.ts`):
            // the layer a user creates by dropping a file into a directory is
            // the one that must not shadow anything.
            void runSkill(result.input)
          } else if (result.kind === 'skill') {
            // `/skill <name> [args]` rewrites to the same line the direct
            // `/<name>` fallback takes, so both invocations share one path —
            // one inject/followup ordering and one set of failure notes.
            void runSkill(result.input)
          }
          // 'exit' is handled inside dispatch by calling appExit; nothing more
          // to do here.
        }, (error: unknown) => {
          // A provider call can reject (unreachable endpoint, bad credential).
          // The failure belongs in the log next to the command that caused it,
          // for the same reason the successful output does.
          appendEntry({
            kind: 'command',
            input: trimmed,
            text: error instanceof Error ? error.message : String(error),
            failed: true,
          })
        })
        return
      }
      setInspection(undefined)
      // `steer` while the driver is running, `followup` while it is idle. Both
      // take the same message; they differ in where the agent puts it. A
      // follow-up becomes the sole ordinary message of a turn of its own, so
      // sending one mid-turn means the correction is read only after the model
      // has finished doing the thing being corrected. Steering is consumed at
      // the next *step* boundary of the turn already running, which is the
      // whole point of typing while it works.
      //
      // Nothing is echoed locally. The steered line reaches the log the same
      // way a follow-up does — as the session's own `user/message` event — so
      // it appears when the agent has actually recorded it rather than when
      // the key was pressed, and a line the agent discards never shows up
      // claiming to have been sent.
      //
      // Attaching is the one thing that has to happen before the message can be
      // built, because an image travels as a content block rather than as text.
      // It is also the one thing here that does I/O, so the send moves behind a
      // promise whenever the line names an image — and stays synchronous when
      // it does not, which is every ordinary message.
      void deliverInput(trimmed).catch((error: unknown) => {
        if (activeAgent.current !== agent) return
        failedDraftRef.current = text
        restoreDraft(text)
        appendEntry({ kind: 'note', tone: 'error', text: `${strings.recovery.draftRestored}\n${error instanceof Error ? error.message : String(error)}` })
      })
    },
    [sessionLibrary, onLibraryChange, deliverInput, notificationMode, setNotificationMode, notify, restoreDraft,
      selectedIndex, searchMatches,
      mousePref, setMouse, setActivity, inspectEntry, jumpEntry, cwd, fullState, historyReady,
      ctx, agent, closeUi, clearView, appendEntry, setModel, refreshSelection, setLanguage, lang,
      setTheme, themePref, appearance, emit, strings, state, shell, swapSession, forkSession,
      scroll.setExpanded, scroll.expanded, attach, statusRef,
    ],
  )

  /**
   * Step through the advertised permission presets, wired to Tab / Shift+Tab
   * on an empty prompt. The submitted line is the same `/permission <value>`
   * the picker's Enter sends, deliberately: the switch keeps its audit trail
   * (command echo plus the plugin's own answer), the busy-check applies, and
   * the chip follows through its knob-event subscription.
   *
   * A `currentValue` outside the advertised options (`custom` — the knobs
   * were set individually) has no position to step from; forward enters the
   * table at its first row and backward at its last, so the key always lands
   * somewhere the projection can name.
   */
  const cyclePermission = useCallback(
    (direction: 1 | -1) => {
      if (permissionPreset === undefined) return
      const values = permissionPreset.options.map(option => option.value)
      if (values.length < 2) return
      const at = values.indexOf(permissionPreset.currentValue)
      const stepped = at === -1
        ? (direction === 1 ? 0 : values.length - 1)
        : (at + direction + values.length) % values.length
      const next = values[stepped]
      if (next === undefined) return
      onSubmit(`/permission ${next}`)
    },
    [permissionPreset, onSubmit],
  )

  if (selection === undefined) {
    return (
      <AppProviders lang={lang} appearance={appearance}>
        <Box marginRight={1}>
          <Prompt active={false} onSubmit={() => {}} spinnerFrame={spinnerFrame} />
        </Box>
      </AppProviders>
    )
  }

  // Bound every TTY frame, including startup and intermediate renders before
  // the prompt reports its new overlay height. Ink switches to clear-and-append
  // when outputHeight reaches stdout.rows; that leaves old banner rows behind.
  // Non-TTY Static output stays intrinsic-height so the banner can scroll away.
  const frameHeight = stdout?.isTTY || state.entries.length > 0
    ? Math.max(1, (stdout?.rows ?? 24) - 3)
    : undefined

  // The settled banner yields space to the prompt's floating list. The root's
  // height and clipping above also guard the earlier frame, before the passive
  // onOverlayRowsChange effect has updated this budget.
  // The reserve is the prompt box (3), the message list's placeholder row (1)
  // and the scroll/exit hint (1), plus whatever the floating list
  // is currently taking.
  const bannerRowBudget = Math.max(0, (frameHeight ?? stdout?.rows ?? 24) - 5 - promptOverlayRows)

  return (
    <AppProviders lang={lang} appearance={appearance}>
      <Box
        flexDirection="column"
        height={frameHeight}
        overflow="hidden"
        marginRight={1}
      >
        {/*
        Keep one physical row free below Ink's live frame. When the root is
        exactly as tall as the terminal, Ink switches to its full-screen output
        path (`outputHeight >= rows`) and writes every resize frame directly,
        bypassing log-update's eraser. The numeric height is refreshed from
        stdout on every resize, so the message list keeps its flex spacer and
        the prompt remains anchored at the bottom while the one-row reserve
        keeps Ink on its incremental frame path.
      */}
        {/*
        `marginRight={1}` keeps the terminal's last column empty, and it is
        load-bearing rather than styling. Ink stretches this column to the
        full terminal width, so every framed child — the prompt box, the
        StatusBar — would otherwise emit lines *exactly* as wide as the
        terminal. A line that fills the last column leaves the terminal with
        a wrap decision to make, and terminals disagree about it: park the
        cursor in the last column and let the following newline move down
        one row (the VT100 reading), or wrap immediately so that newline
        lands a row further down. Under the second reading a 3-line frame
        occupies 6 physical rows while Ink erases
        `eraseLines(<logical line count>)` = 4, so every redraw leaks two
        rows onto the screen — which is exactly the ladder of half-drawn
        prompt boxes a window drag produced. One reserved column costs
        nothing visible, makes the frame unwrappable under either reading,
        and absorbs a one-column lag between SIGWINCH and the write. See
        `tests/frame-erase.spec.ts`.
      */}
        {/*
        The brand splash is generous (19 rows), and the live frame is only
        `rows - 3` tall, so it can only be on screen while there is nothing
        else to show. Once the first message lands the StatusBar takes over
        as the live header — same identity, plus the token counts — and those
        19 rows go back to the conversation. Leaving both on screen is what
        squeezed the message list down to a handful of rows and clipped the
        newest messages away entirely; inside the alternate screen there is
        no scrollback for them to scroll into, so the banner has to yield.
        `/clear` empties the log and the banner comes back with it.

        The `width: '100%'` on the non-TTY path is load-bearing: a `<Static>`
        box is absolutely positioned, so with no width it sizes to its
        content and the banner frame stops meeting the terminal's right edge.

        So is keeping that `<Static>` mounted with an empty `items` once the
        first entry lands, rather than dropping the element. `<Static>` means
        "already written, never again", and an empty list says that exactly;
        unmounting it instead leaves Ink holding an absolutely positioned box
        whose width it re-measures as 0 on the next render, and its border
        renderer takes `width - 2` as a repeat count and throws
        `RangeError: Invalid count value: -2`. See `tests/boot-notice.spec.ts`.
      */}
        {stdout?.isTTY ? (
          state.entries.length === 0 && (
            <Banner cwd={cwd} selection={selection} sessionId={agent.id} availableRows={bannerRowBudget} />
          )
        ) : (
          <Static items={state.entries.length === 0 ? [0] : []} style={{ width: '100%' }}>
            {() => <Banner cwd={cwd} key="banner" selection={selection} sessionId={agent.id} />}
          </Static>
        )}
        {state.entries.length > 0 && (
          <StatusBar
            selection={selection}
            sessionId={agent.id}
            state={state}
            spinnerFrame={spinnerFrame}
            elapsedSeconds={elapsedSeconds}
            preset={permissionPreset}
          />
        )}
        <MessageList
          state={transcript}
          offset={scroll.offset}
          pinTop={scroll.pinTop || browseFull}
          expanded={scroll.expanded}
          onGeometry={scroll.reportGeometry}
          onToggleActivity={setActivity}
          jumpIndex={jumpTarget ? transcript.entries.findIndex(entry => entry === jumpTarget || (entry.kind === 'assistant' && jumpTarget.kind === 'assistant' && entry.turn === jumpTarget.turn && entry.step === jumpTarget.step)) : undefined}
          onJump={(offset) => { scroll.jumpToOffset(offset); setJumpTarget(undefined) }}
        />
        {/*
        The only cue that the view is not at the live tail. A terminal
        scrollbar would say this for free, but the alternate screen has
        neither one nor a scrollback, so the row has to be earned from the
        layout.

        It is reserved unconditionally, and that is the point: a hint row
        that appears only while scrolled steals a row from the viewport at
        the moment it appears, so PageUp and PageDown size their steps
        against different heights and a page down no longer undoes the page
        up that preceded it. One permanently reserved row buys invertible
        paging and a viewport that does not reflow the instant you touch the
        wheel. Only the text is conditional.
      */}
        <Box paddingX={1} height={1} flexShrink={0}>
          {exitArmed
            ? (
              <Text color="yellow" wrap="truncate">
                {strings.interrupt.confirmExit}
              </Text>
            )
            : scroll.atTail
              ? (pendingTurns + pendingSteps > 0 ? <Text dimColor wrap="truncate">{strings.queue.pending(pendingTurns, pendingSteps)}</Text> : null)
              : (
                <Text color="yellow" dimColor wrap="truncate">
                  {strings.scroll.hint(scroll.offset)}
                </Text>
              )}
        </Box>
        {/*
        Above the prompt rather than in place of it. A pending approval is the
        one thing that still makes the prompt inert — a running turn no longer
        does, since the line steers it — so `y`/`n`/`Esc` reach the card and
        nothing else. Keeping the input row on screen means the question does
        not make the layout jump by a variable number of rows as it comes and
        goes.
      */}
        <ApprovalPrompt
          pending={approvals.pending}
          onAnswer={approvals.answer}
          argsFor={argsForCall}
          diffsFor={diffsForCall}
        />
        <Prompt
          key={agent.id}
          editExternally={editExternally}
          pasteImage={pasteImage}
          onInputNotice={text => appendEntry({ kind: 'note', tone: 'warn', text })}
          draftChannel={draftChannel}
          onDraftFailure={onDraftFailure}
          cwd={cwd}
          active={!shell.running && approvals.pending.length === 0}
          busy={state.status === 'running' || shell.running}
          onSubmit={onSubmit}
          spinnerFrame={spinnerFrame}
          onArrowClaimChange={setPromptClaimsArrows}
          onFilledChange={setPromptFilled}
          onEscClaimChange={setPromptClaimsEsc}
          keybinds={keybindPref}
          onOverlayRowsChange={setPromptOverlayRows}
          extraCommands={registryRows}
          sessionCommands={sessionCommands}
          onValueChange={onPromptValue}
          restoreDraft={draftRequest?.sessionId === agent.id ? draftRequest : undefined}
          skillCommands={skillRowsForPicker}
          permissionCommands={permissionRowsForPicker}
          onCyclePermission={permissionRowsForPicker.length > 1 ? cyclePermission : undefined}
          modelCommands={modelRowsForPicker}
        />
      </Box>
    </AppProviders>
  )
}
