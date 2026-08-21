/**
 * The Ink root component: composes the status bar, the message list, and
 * the prompt. Owns the live projection of the agent's session, the
 * dispatch of slash commands, and the Ctrl-C interrupt path.
 * @module @deepseek-ai/dsh-tui/renderer
 */

import { Box, useApp, useInput } from 'ink'
import React, { useCallback, useState, type FC } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
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
  /**
   * The live agent's mutable model selection, owned by the runner.
   * `/model` writes it to re-route the running agent; the App reads the
   * result back to keep the status bar honest.
   */
  selectionRef?: ModelSelectionRef
}

/**
 * The TUI root. Subscribes to the agent's session, dispatches user input
 * to the agent or to a slash command, and composes the three-pane layout.
 */
export const App: FC<AppProps> = ({ ctx, agent, exit, selectionRef }) => {
  const { exit: closeUi } = useApp()
  const { state, resetView } = useSessionEvents(ctx, agent)
  // State, not a memo: `/model` changes this mid-session. The initial
  // value comes from the ref the runner installed on the agent, so the
  // bar shows what the agent will actually route to rather than what
  // the settings file happens to say.
  const [selection, setSelection] = useState(
    () => selectionRef?.current ?? ctx.get('agentDefaultModel')?.currentSelection(),
  )
  // The animated "thinking" indicator. One interval per status
  // transition; both the StatusBar (right-side) and the Prompt
  // (placeholder) read from the same frame index so the spinner
  // glyph is in lock-step on screen.
  const { spinnerFrame, elapsedSeconds } = useRunningClock(state.status === 'running')

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
        // Fire and forget: dispatch is async only because `/model` reads
        // provider catalogs. Awaiting here would block the input handler
        // and freeze the prompt while a provider endpoint is slow.
        void dispatch(trimmed, { ctx, agent, resetView, selectionRef }).then((result) => {
          if (result.kind === 'handled') {
            if (result.selection) setSelection(result.selection)
            if (result.message) process.stderr.write(`\n${result.message}\n`)
          } else if (result.kind === 'unknown') {
            process.stderr.write(`\nunknown command: ${result.input}\n`)
          }
          // 'exit' is handled inside dispatch by calling appExit; nothing
          // more to do here.
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
    [ctx, agent, resetView, selectionRef],
  )

  if (selection === undefined) {
    return <Box><Prompt active={false} onSubmit={() => {}} spinnerFrame={spinnerFrame} /></Box>
  }

  return (
    <Box flexDirection="column" height="100%">
      {/*
        The brand splash is generous (13 rows) so it only earns its
        keep while there is nothing else to show. As soon as the first
        message lands it collapses into the compact StatusBar, which
        carries the same information plus the live token counts.
      */}
      {state.entries.length === 0 ? (
        <Banner selection={selection} sessionId={agent.id} />
      ) : (
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
