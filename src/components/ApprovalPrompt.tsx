/**
 * The permission question. Shown in place of the running-turn prompt while a
 * tool waits on a human answer, because that is exactly when it appears: the
 * approval service requires an open turn, and the prompt's own `useInput` is
 * already `isActive: false` while one runs. The two therefore never compete for
 * a keystroke, which is why this component can take input without joining the
 * arrow-key arbitration the prompt and message list needed.
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
import type { PendingApproval } from '../hooks/useApprovalRequests.ts'
import { useStrings } from '../hooks/useStrings.tsx'

/** Props for {@link ApprovalPrompt}. */
export interface ApprovalPromptProps {
  /** Questions waiting on the user, oldest first. May be empty. */
  pending: readonly PendingApproval[]
  /** Settle the question with `id`. */
  onAnswer: (id: number, outcome: ApprovalOutcome) => void
}

export const ApprovalPrompt: FC<ApprovalPromptProps> = ({ pending, onAnswer }) => {
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
  return (
    <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
      <Box>
        <Text color="yellow" bold>{`${strings.approval.title} `}</Text>
        <Text bold>{current.toolName}</Text>
        {waiting > 0 && (
          <Text color="gray">{strings.approval.more(waiting)}</Text>
        )}
      </Box>
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
