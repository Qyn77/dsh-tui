/**
 * The Ink root component: composes the status bar, the message list, and
 * the prompt. Owns the live projection of the agent's session, the
 * dispatch of slash commands, and the Ctrl-C interrupt path.
 * @module @deepseek-ai/dsh-tui/renderer
 */

import { Box, Static, Text, useApp, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useMemo, useState, type FC } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MessageList } from './components/MessageList.tsx'
import { Prompt } from './components/Prompt.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Banner } from './components/Banner.tsx'
import { useRunningClock } from './hooks/useRunningClock.ts'
import { useResizeRepaint } from './hooks/useResizeRepaint.ts'
import { useMessageListScroll } from './hooks/useMessageListScroll.ts'
import { useSessionEvents } from './hooks/useSessionEvents.ts'
import { service } from './services.ts'
import { dispatch } from './commands.ts'
import { handleInterrupt } from './interrupt.ts'
import type { RepaintRef } from './resize.ts'



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
   * Where the App publishes Ink's `useStdout().write` for the resize owner
   * in `index.ts` to borrow. That writer is the only way to make Ink emit a
   * frame it considers unchanged, and it is reachable from inside the tree
   * only. Omitted by tests that do not resize.
   */
  repaint?: RepaintRef
}

/**
 * The TUI root. Subscribes to the agent's session, dispatches user input
 * to the agent or to a slash command, and composes the three-pane layout.
 */
export const App: FC<AppProps> = ({ ctx, agent, exit, repaint }) => {
  const { exit: closeUi } = useApp()
  const { stdout, write } = useStdout()
  const { state, resetView, appendEntry } = useSessionEvents(ctx, agent)
  const selection = useMemo(
    () => service(ctx, 'agentDefaultModel')?.currentSelection(),
    [ctx],
  )
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
      handleInterrupt({ agent, closeUi, exit })
    }
  })

  const onSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      if (trimmed.startsWith('/')) {
        const result = dispatch(trimmed, { ctx, agent, resetView: clearView })
        // Command output goes into the log, not to stderr. Inside the
        // alternate screen a stderr write lands on the same rows Ink is
        // driving, so it is erased by the next frame or wedged into one —
        // which made `/help` and `/status` print nothing readable at all.
        if (result.kind === 'handled' && result.message !== undefined) {
          appendEntry({ kind: 'command', input: trimmed, text: result.message, failed: false })
        } else if (result.kind === 'unknown') {
          appendEntry({
            kind: 'command',
            input: result.input,
            text: 'unknown command — /help lists them',
            failed: true,
          })
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
    [ctx, agent, clearView, appendEntry],
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
  // Leave three rows outside Ink's dynamic output. If outputHeight reaches
  // stdout.rows, Ink intentionally switches to clearTerminal + append mode,
  // which cannot erase a previous frame during a resize. Keeping the frame
  // strictly shorter makes log-update erase the previous render normally.
  const frameHeight = state.entries.length > 0 ? Math.max(1, (stdout?.rows ?? 24) - 3) : undefined

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
      */}
      {state.entries.length === 0 &&
        (stdout?.isTTY ? (
          <Banner selection={selection} sessionId={agent.id} />
        ) : (
          <Static items={[0]} style={{ width: '100%' }}>
            {() => <Banner key="banner" selection={selection} sessionId={agent.id} />}
          </Static>
        ))}
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
            ↓ {scroll.offset} more row{scroll.offset === 1 ? '' : 's'} below · End jumps to the
            latest
          </Text>
        )}
      </Box>
      <Prompt
        active={state.status === 'idle'}
        onSubmit={onSubmit}
        spinnerFrame={spinnerFrame}
        onArrowClaimChange={setPromptClaimsArrows}
      />
    </Box>
  )
}
