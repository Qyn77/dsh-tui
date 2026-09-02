/**
 * The Ink root component: composes the status bar, the message list, and
 * the prompt. Owns the live projection of the agent's session, the
 * dispatch of slash commands, and the Ctrl-C interrupt path.
 * @module @deepseek-ai/dsh-tui/renderer
 */

import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useRef, useState, type FC } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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
import { parseShellInput } from './shell.ts'
import { service } from './services.ts'
import { dispatch } from './commands.ts'
import { handleInterrupt } from './interrupt.ts'
import { catalog, type Lang } from './i18n.ts'
import { LanguageProvider } from './hooks/useStrings.tsx'
import { writeSettings } from './settings.ts'
import { CLEAR_SCREEN, type RepaintRef } from './resize.ts'



/** Props for the TUI root component. */
export interface AppProps {
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
}

/**
 * The TUI root. Subscribes to the agent's session, dispatches user input
 * to the agent or to a slash command, and composes the three-pane layout.
 */
export const App: FC<AppProps> = ({
  ctx,
  agent,
  exit,
  modelRef,
  repaint,
  notice,
  lang: initialLang = 'en',
}) => {
  const { exit: closeUi } = useApp()
  const { stdout, write } = useStdout()
  const { state, resetView, appendEntry } = useSessionEvents(ctx, agent)
  const extraCommands = useRegistryCommands(ctx, agent)
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
  // The interface language, for the same reason the selection is state:
  // `/language` changes it mid-session and every framed string has to follow.
  const [lang, setLang] = useState<Lang>(initialLang)
  const strings = catalog(lang)
  // `!` escapes. Declared here because both the interrupt handler and the
  // submit handler need it, and it is the owner of the working directory.
  const shell = useShell({ agent, appendEntry, strings })
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
  // The animated "thinking" indicator. One interval per status
  // transition; both the StatusBar (right-side) and the Prompt
  // (placeholder) read from the same frame index so the spinner
  // glyph is in lock-step on screen.
  const { spinnerFrame, elapsedSeconds } = useRunningClock(state.status === 'running')

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

  // Scroll position for the conversation viewport, in rows above the newest
  // row. It lives here rather than inside the MessageList because the
  // "scrolled into history" hint is a sibling of the list, and because the
  // key bindings belong at the root next to the Ctrl-C handler.
  const scroll = useMessageListScroll({ arrowsScroll: !promptClaimsArrows })


  // Ink's frame eraser is cursor-relative, so a terminal that rewraps the
  // rows already on screen when the window narrows leaves debris behind
  // that no width arithmetic can prevent. Once a resize settles, throw the
  // screen away and let Ink lay the frame down again.

  const clearView = useCallback(() => {
    resetView()
  }, [resetView])

  // Ink's raw mode delivers Ctrl-C as a keystroke (input 'c' with
  // key.ctrl), not as a SIGINT signal. The Prompt's useInput also sees
  // this keystroke and would otherwise append 'c' to the buffer; the
  // Prompt handles that on its side, and the App handles the interrupt
  // here. This runs even when the prompt is "inactive" (a turn is
  // running) so the user can cancel a long turn.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      handleInterrupt({
        agent,
        closeUi,
        exit,
        shellRunning: shell.running,
        abortShell: shell.abort,
      })
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
        // `dispatch` is async (model listing and context resolution both need
        // provider I/O). Ink ignores a handler's return value, so the promise
        // is driven here and its result appended when it settles — the prompt
        // stays responsive while a provider call is in flight.
        void dispatch(trimmed, {
          ctx,
          agent,
          resetView: clearView,
          setModel,
          refreshSelection,
          setLanguage,
          lang,
          state,
        }).then((result) => {
          // Command output goes into the log, not to stderr. Inside the
          // alternate screen a stderr write lands on the same rows Ink is
          // driving, so it is erased by the next frame or wedged into one —
          // which made `/help` and `/status` print nothing readable at all.
          if (result.kind === 'handled' && result.message !== undefined) {
            appendEntry({
              kind: 'command',
              input: trimmed,
              text: result.message,
              failed: result.failed === true,
            })
          } else if (result.kind === 'unknown') {
            appendEntry({
              kind: 'command',
              input: result.input,
              text: strings.output.unknownCommand,
              failed: true,
            })
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
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: trimmed }],
          source: { kind: 'user' },
        }),
      )
    },
    [ctx, agent, clearView, appendEntry, setModel, refreshSelection, setLanguage, lang, strings, state, shell],
  )

  if (selection === undefined) {
    return (
      <LanguageProvider lang={lang}>
        <Box marginRight={1}>
          <Prompt active={false} onSubmit={() => {}} spinnerFrame={spinnerFrame} />
        </Box>
      </LanguageProvider>
    )
  }

  // An empty session must stay intrinsic-height: making the dynamic frame
  // full-screen would emit dozens of blank rows after the static banner,
  // scrolling the banner out of the viewport on startup. Once there is
  // conversation content, the message list can flex and the prompt belongs
  // at the bottom of the terminal.
  // Leave three rows outside Ink's dynamic output. If outputHeight reaches
  // stdout.rows, Ink intentionally switches to clearTerminal + append mode,
  // which cannot erase a previous frame during a resize. Keeping the frame
  // strictly shorter makes log-update erase the previous render normally.
  const frameHeight = state.entries.length > 0 ? Math.max(1, (stdout?.rows ?? 24) - 3) : undefined

  return (
    <LanguageProvider lang={lang}>
      <Box flexDirection="column" height={frameHeight} marginRight={1}>
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
          state.entries.length === 0 && <Banner selection={selection} sessionId={agent.id} />
        ) : (
          <Static items={state.entries.length === 0 ? [0] : []} style={{ width: '100%' }}>
            {() => <Banner key="banner" selection={selection} sessionId={agent.id} />}
          </Static>
        )}
        {state.entries.length > 0 && (
          <StatusBar
            selection={selection}
            sessionId={agent.id}
            state={state}
            spinnerFrame={spinnerFrame}
            elapsedSeconds={elapsedSeconds}
          />
        )}
        <MessageList
          state={state}
          offset={scroll.offset}
          pinTop={scroll.pinTop}
          onGeometry={scroll.reportGeometry}
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
          {scroll.atTail ? null : (
            <Text color="yellow" dimColor wrap="truncate">
              {strings.scroll.hint(scroll.offset)}
            </Text>
          )}
        </Box>
        {/*
        Above the prompt rather than in place of it. The prompt is inert while a
        turn runs (`active` is false), so the two never fight over a keystroke,
        and keeping the input row on screen means the question does not make the
        layout jump by a variable number of rows as it comes and goes.
      */}
        <ApprovalPrompt pending={approvals.pending} onAnswer={approvals.answer} />
        <Prompt
          active={state.status === 'idle' && !shell.running}
          onSubmit={onSubmit}
          spinnerFrame={spinnerFrame}
          onArrowClaimChange={setPromptClaimsArrows}
          extraCommands={extraCommands}
        />
      </Box>
    </LanguageProvider>
  )
}
