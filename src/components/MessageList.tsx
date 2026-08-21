/**
 * The scrollable conversation area. Renders user messages, streaming
 * assistant text, tool call cards, and lifecycle notes.
 * @module @deepseek-ai/dsh-tui/components/MessageList
 */

import React, { type FC } from 'react'
import { Box, Text } from 'ink'
import type { UiEntry, UiState } from '../types.ts'
import { userMessageText } from '../types.ts'
import { Markdown } from './Markdown.tsx'

/** Props for {@link MessageList}. */
export interface MessageListProps {
  state: UiState
}

const COMPACTION_LABELS: Record<Extract<UiEntry, { kind: 'compaction' }>['stage'], string> = {
  start: 'compacting…',
  summary: 'compacting…',
  prune: 'compacting…',
  end: 'compaction complete',
}

function ToolCard({ entry }: { entry: Extract<UiEntry, { kind: 'tool' }> }) {
  const borderColor =
    entry.status === 'error' ? 'red' : entry.status === 'ok' ? 'green' : 'yellow'
  const statusLabel =
    entry.status === 'error' ? '✗ error' : entry.status === 'ok' ? '✓ done' : '… running'
  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor={borderColor} paddingX={1}>
      <Box>
        <Text color="gray">tool </Text>
        <Text bold color="cyan">
          {entry.name}
        </Text>
        <Text color="gray">  </Text>
        <Text color={borderColor}>{statusLabel}</Text>
      </Box>
      {entry.args && (
        <Box marginLeft={2}>
          <Text color="gray">{truncate(entry.args, 240)}</Text>
        </Box>
      )}
      {entry.result && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text color="gray">result:</Text>
          <Text>{summarizeResult(entry.result)}</Text>
        </Box>
      )}
      {entry.error && (
        <Box marginLeft={2} marginTop={1}>
          <Text color="red">
            {entry.error.name}: {entry.error.code}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function summarizeResult(message: { content: readonly { type: string; text?: string }[] }): string {
  const text = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
  return truncate(text, 400)
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function AssistantBlock({ entry }: { entry: Extract<UiEntry, { kind: 'assistant' }> }) {
  // While the turn is still streaming, show raw text — re-parsing
  // partial markdown on every chunk risks a half-open fence or an
  // italic delimiter that hasn't closed yet, both of which would
  // churn the layout. Once the turn finalizes we re-render the full
  // block as markdown. The transition fires on the assistant/message
  // event, not on a timer, so it doesn't trigger the scroll-snap
  // regression that lives in `docs/lessons/prompt-scroll-snaps.md`.
  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Box>
        <Text color="magenta" bold>
          assistant
        </Text>
        <Text color="gray"> · turn {entry.turn} step {entry.step}</Text>
        {!entry.finalized && <Text color="yellow"> · streaming</Text>}
      </Box>
      <Box marginLeft={2} flexDirection="column">
        {entry.finalized ? (
          <Markdown source={entry.text} />
        ) : (
          <Text>{entry.text || ' '}</Text>
        )}
      </Box>
    </Box>
  )
}

function UserBlock({ entry }: { entry: Extract<UiEntry, { kind: 'user' }> }) {
  return (
    <Box flexDirection="column" marginY={1} paddingX={1}>
      <Box>
        <Text color="blue" bold>
          you
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text>{userMessageText(entry.message) || ' '}</Text>
      </Box>
    </Box>
  )
}

function NoteLine({ entry }: { entry: Extract<UiEntry, { kind: 'note' }> }) {
  return (
    <Box marginY={1}>
      <Text color="gray" dimColor>
        {entry.text}
      </Text>
    </Box>
  )
}

function CompactionLine({ entry }: { entry: Extract<UiEntry, { kind: 'compaction' }> }) {
  return (
    <Box marginY={1}>
      <Text color="cyan" dimColor>
        ⤷ {COMPACTION_LABELS[entry.stage]}
      </Text>
    </Box>
  )
}

function PlanLine({ entry }: { entry: Extract<UiEntry, { kind: 'plan' }> }) {
  return (
    <Box marginY={1}>
      <Text color={entry.enabled ? 'yellow' : 'gray'}>
        ⤷ plan mode {entry.enabled ? 'on' : 'off'}
      </Text>
    </Box>
  )
}

function RuntimeContextLine({ entry }: { entry: Extract<UiEntry, { kind: 'runtime-context' }> }) {
  // Header carries the producer and form so the user can see which
  // plugin injected this context (e.g. agent-instructions shipping a
  // <system-reminder>). The preview is a short, dimmed sample of the
  // payload — full text would crowd the chat surface.
  const header = `⤷ runtime context${entry.plugin ? ` · ${entry.plugin}` : ''}${entry.form ? ` (${entry.form})` : ''}`
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="gray" dimColor>
        {header}
      </Text>
      {entry.preview !== '' && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor>
            {entry.preview}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function Entry({ entry }: { entry: UiEntry }) {
  switch (entry.kind) {
    case 'user':
      return <UserBlock entry={entry} />
    case 'assistant':
      return <AssistantBlock entry={entry} />
    case 'tool':
      return <ToolCard entry={entry} />
    case 'note':
      return <NoteLine entry={entry} />
    case 'compaction':
      return <CompactionLine entry={entry} />
    case 'plan':
      return <PlanLine entry={entry} />
    case 'runtime-context':
      return <RuntimeContextLine entry={entry} />
    default: {
      // Exhaustiveness: a new UiEntry variant will fail to compile here.
      const _exhaustive: never = entry
      return <Text>{String(_exhaustive)}</Text>
    }
  }
}

export const MessageList: FC<MessageListProps> = ({ state }) => {
  if (state.entries.length === 0) {
    // No empty-state copy: on an empty session the Banner is on screen
    // directly above, and its tip line already says how to start and
    // where the commands are. A second hint saying the same thing read
    // as clutter.
    return <Box flexGrow={1} />
  }
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {state.entries.map((entry, idx) => (
        <Entry key={idx} entry={entry} />
      ))}
    </Box>
  )
}
