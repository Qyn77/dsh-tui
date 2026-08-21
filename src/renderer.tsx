/**
 * The Ink root component: composes the status bar, the message list, and
 * the prompt. Owns the live projection of the agent's session, the
 * dispatch of slash commands, and the Ctrl-C interrupt path.
 * @module @deepseek-ai/dsh-tui/renderer
 */

import { Box, Static, useApp, useInput } from 'ink'
import React, { useCallback, useMemo, useState, type FC } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MessageList } from './components/MessageList.tsx'
import { Prompt } from './components/Prompt.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Banner } from './components/Banner.tsx'
import { useRunningClock } from './hooks/useRunningClock.ts'
import { useSessionEvents } from './hooks/useSessionEvents.ts'
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

  // The banner is *static* output: Ink writes each `<Static>` item to the
  // terminal exactly once and never redraws it. That is not a
  // micro-optimisation, it is the fix for a real corruption. Ink erases
  // the previous frame with `eraseLines(<logical line count>)`, which
  // undercounts the moment a line is wide enough for the terminal to
  // wrap it — and Ink redraws the *whole* dynamic frame on every stdout
  // `resize` event. A 19-row banner inside that frame therefore left a
  // shredded copy of itself on screen for each resize the terminal
  // emitted while starting up. Outside the frame it cannot: nothing
  // ever redraws it.
  //
  // One item per "screen". `/clear` empties the view and prints a fresh
  // banner, which is what it did while the banner still lived in the
  // dynamic tree.
  const [screens, setScreens] = useState(1)
  const bannerItems = useMemo(
    () => Array.from({ length: screens }, (_, i) => i),
    [screens],
  )
  const clearView = useCallback(() => {
    resetView()
    setScreens((n) => n + 1)
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
    return <Box><Prompt active={false} onSubmit={() => {}} spinnerFrame={spinnerFrame} /></Box>
  }

  return (
    <Box flexDirection="column" height="100%">
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
      <Static items={bannerItems} style={{ width: '100%' }}>
        {(screen) => (
          <Banner key={screen} selection={selection} sessionId={agent.id} />
        )}
      </Static>
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
