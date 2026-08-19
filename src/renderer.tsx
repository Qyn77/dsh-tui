/**
 * The Ink root component: composes the status bar, the message list, and
 * the prompt. Owns the live projection of the agent's session, the
 * dispatch of slash commands, and the Ctrl-C interrupt path.
 * @module @deepseek-ai/dsh-tui/renderer
 */

import { Box, useApp, useInput } from 'ink'
import React, { useCallback, useMemo, type FC } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MessageList } from './components/MessageList.tsx'
import { Prompt } from './components/Prompt.tsx'
import { StatusBar } from './components/StatusBar.tsx'
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
        const result = dispatch(trimmed, { ctx, agent, resetView })
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
    [ctx, agent, resetView],
  )

  if (selection === undefined) return <Box><Prompt active={false} onSubmit={() => {}} /></Box>

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar selection={selection} sessionId={agent.id} state={state} />
      <MessageList state={state} />
      <Prompt active={state.status === 'idle'} onSubmit={onSubmit} />
    </Box>
  )
}
