/**
 * The permission question. Shown above the prompt while a tool waits on a
 * human answer. A pending question is the one thing that closes the prompt's
 * own `useInput` — the box stays live through a running turn so the line can
 * steer it (SPEC §1.6), so "a turn is running" is no longer enough — and that
 * is why this component can take input without joining the arrow-key
 * arbitration the prompt and message list needed.
 *
 * The card shows the call's arguments, which the request itself does not
 * carry: `ApprovalRequest` has a tool name, a reason and a `callId`, and the
 * arguments are found by that id in the log the App already streamed. Without
 * them the question is "allow Bash?", which is not a question anyone can
 * answer.
 *
 * Only the oldest question is drawn. A parallel tool batch can ask more than
 * once, and stacking cards would put the terminal in the position of asking two
 * questions whose answers interact while showing only one set of keys. The
 * count of the rest is stated instead, so the user knows more is coming.
 *
 * `y` and `n` are the whole vocabulary: `'allowed-once'` is the only grant the
 * approval service defines, so there is no "always" to offer. Esc rejects,
 * matching the prompt's "Esc dismisses" habit.
 * @module @deepseek-ai/dsh-tui/components/ApprovalPrompt
 */

import React, { type FC } from 'react'
import { Box, Text, useInput } from 'ink'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { PendingApproval } from '../hooks/useApprovalRequests.ts'
import { approvalArgs, parseToolName } from '../message-layout.ts'
import { useStrings } from '../hooks/useStrings.tsx'

/** Props for {@link ApprovalPrompt}. */
export interface ApprovalPromptProps {
  /** Questions waiting on the user, oldest first. May be empty. */
  pending: readonly PendingApproval[]
  /** Settle the question with `id`. */
  onAnswer: (id: number, outcome: ApprovalOutcome) => void
  /**
   * The arguments of the call with `callId`, as the raw JSON string the log
   * holds, or `undefined` when there is no such entry.
   *
   * A resolver rather than the arguments themselves, because which question is
   * on screen is this component's decision (the oldest) and the App should not
   * have to duplicate that rule to look one up. Optional: a card rendered
   * without it shows the tool's name and reason, which is what it always did.
   */
  argsFor?: (callId: CallId) => string | undefined
}

export const ApprovalPrompt: FC<ApprovalPromptProps> = ({ pending, onAnswer, argsFor }) => {
  const strings = useStrings()
  const current = pending[0]

  // Registered unconditionally with `isActive`, not behind an early return:
  // Ink's `useInput` is a hook, so a return above it would change the hook
  // order between "a question is pending" and "none is".
  useInput((input, key) => {
    if (current === undefined) return
    const ch = input.toLowerCase()
    if (ch === 'y') onAnswer(current.id, 'allowed-once')
    else if (ch === 'n' || key.escape) onAnswer(current.id, 'rejected')
  }, { isActive: current !== undefined })

  if (current === undefined) return null
  const waiting = pending.length - 1
  // No `callId` and no entry both mean the same thing here — nothing to show —
  // so neither is distinguished. The question is still answerable without it.
  // Undimmed yellow, not gray: an MCP call sends its arguments to a process
  // this app did not start, and that is the fact most likely to change the
  // answer. It is drawn directly under the tool name, above the arguments, so
  // a call with many of them cannot push it out of view.
  const mcp = parseToolName(current.toolName)
  const raw = current.callId === undefined ? undefined : argsFor?.(current.callId)
  const args = raw === undefined ? undefined : approvalArgs(raw)
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Box>
        <Text color="yellow" bold>{`${strings.approval.title} `}</Text>
        <Text bold>{mcp.server === undefined ? mcp.tool : `${mcp.server}:${mcp.tool}`}</Text>
        {waiting > 0 && (
          <Text color="gray">{strings.approval.more(waiting)}</Text>
        )}
      </Box>
      {mcp.server !== undefined && (
        // Its own row rather than a suffix on the heading. Sharing the row put
        // the tool name and the notice in competition for a narrow card, and
        // Ink resolved it by breaking the tool name mid-word — the one string
        // on the card that must stay readable.
        <Text color="yellow" wrap="truncate-end">{strings.approval.viaMcp(mcp.server)}</Text>
      )}
      {args !== undefined && args.rows.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {args.rows.map(arg => (
            <Text key={arg.key} wrap="truncate-end">
              {arg.key === '' ? '' : <Text color="gray">{`${arg.key}: `}</Text>}
              {arg.value}
            </Text>
          ))}
          {args.hidden > 0 && (
            <Text color="gray" dimColor>{strings.approval.moreArgs(args.hidden)}</Text>
          )}
        </Box>
      )}
      {current.reason !== undefined && (
        <Box marginTop={1}>
          <Text color="gray">{current.reason}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {strings.approval.hint}
        </Text>
      </Box>
    </Box>
  )
}
