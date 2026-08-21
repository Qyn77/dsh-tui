/**
 * The Ink root component: composes the status bar, the message list, and
 * the prompt. Owns the live projection of the agent's session, the
 * dispatch of slash commands, and the Ctrl-C interrupt path.
 * @module @deepseek-ai/dsh-tui/renderer
 */

import { Box, Static, useApp, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useMemo, useState, type FC } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MessageList } from './components/MessageList.tsx'
import { Prompt } from './components/Prompt.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Banner } from './components/Banner.tsx'
import { useRunningClock } from './hooks/useRunningClock.ts'
import { useSessionEvents } from './hooks/useSessionEvents.ts'
import { useResizeRepaint } from './hooks/useResizeRepaint.ts'
import { dispatch } from './commands.ts'
import { handleInterrupt } from './interrupt.ts'

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
}

/**
 * The TUI root. Subscribes to the agent's session, dispatches user input
 * to the agent or to a slash command, and composes the three-pane layout.
 */
export const App: FC<AppProps> = ({ ctx, agent, exit }) => {
  const { exit: closeUi } = useApp()
  const { stdout } = useStdout()
  const realTty = stdout?.isTTY === true
  const [terminalRows, setTerminalRows] = useState(() => stdout?.rows ?? 24)
  useEffect(() => {
    if (stdout === undefined || typeof stdout.on !== 'function') return
    const onResize = (): void => {
      setTerminalRows(stdout.rows ?? 24)
    }
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout])
  const { state, resetView } = useSessionEvents(ctx, agent)
  const selection = useMemo(
    () => ctx.get('agentDefaultModel')?.currentSelection(),
    [ctx],
  )
  // The animated "thinking" indicator. One interval per status
  // transition; both the StatusBar (right-side) and the Prompt
  // (placeholder) read from the same frame index so the spinner
  // glyph is in lock-step on screen.
  const { spinnerFrame, elapsedSeconds } = useRunningClock(state.status === 'running')


  // Ink's frame eraser is cursor-relative, so a terminal that rewraps the
  // rows already on screen when the window narrows leaves debris behind
  // that no width arithmetic can prevent. Once a resize settles, throw the
  // screen away and let Ink lay the frame down again.
  useResizeRepaint()

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
      handleInterrupt({ agent, closeUi, exit })
    }
  })

  const onSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      if (trimmed.startsWith('/')) {
        const result = dispatch(trimmed, { ctx, agent, resetView: clearView })
        if (result.kind === 'handled' && result.message) {
          process.stderr.write(`\n${result.message}\n`)
        } else if (result.kind === 'unknown') {
          process.stderr.write(`\nunknown command: ${result.input}\n`)
        }
        // 'exit' is handled inside dispatch by calling appExit; nothing more
        // to do here.
        return
      }
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: trimmed }],
          source: { kind: 'user' },
        }),
      )
    },
    [ctx, agent, clearView],
  )

  if (selection === undefined) {
    return (
      <Box marginRight={1}>
        <Prompt active={false} onSubmit={() => {}} spinnerFrame={spinnerFrame} />
      </Box>
    )
  }

  // An empty session must stay intrinsic-height: making the dynamic frame
  // full-screen would emit dozens of blank rows after the static banner,
  // scrolling the banner out of the viewport on startup. Once there is
  // conversation content, the message list can flex and the prompt belongs
  // at the bottom of the terminal.
  const frameHeight = state.entries.length > 0 ? Math.max(1, terminalRows - 1) : undefined

  return (
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
        The brand splash is generous (19 rows), so it is written once as
        static output and then scrolls away like any other past output —
        it never re-renders and never costs the live frame a row. The
        `width: '100%'` is load-bearing: a `<Static>` box is absolutely
        positioned, so with no width it sizes to its content and the
        banner frame stops meeting the terminal's right edge.

        The StatusBar takes over as the live header as soon as there is a
        message to head, carrying the same identity plus the token counts.
      */}
      {realTty ? (
        <Banner selection={selection} sessionId={agent.id} />
      ) : (
        <Static items={[0]} style={{ width: '100%' }}>
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
      <MessageList state={state} />
      <Prompt
        active={state.status === 'idle'}
        onSubmit={onSubmit}
        spinnerFrame={spinnerFrame}
      />
    </Box>
  )
}
