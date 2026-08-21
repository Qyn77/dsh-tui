/**
 * The scrollable conversation area. Renders user messages, streaming
 * assistant text, tool call cards, and lifecycle notes.
 *
 * The viewport's height is **measured, not calculated**. It is a flex item
 * with a zero basis, so the layout hands it whatever the StatusBar and the
 * Prompt leave over, and `measureElement` reads back how many rows that
 * turned out to be. The scroll offset is bounded by that measurement,
 * which is what makes both ends of the log exact stops.
 *
 * Tail-following is structural rather than arithmetic: the viewport is a
 * `column-reverse` box, so the content's bottom edge is pinned to the
 * viewport's bottom edge and any excess is clipped off the *top*. The
 * newest row is therefore on screen by construction, at any content
 * height, with no measurement involved. Scrolling up is a negative
 * `marginBottom` on the content, which slides it down past the bottom edge
 * one row at a time.
 *
 * Do not reach for `justifyContent="flex-end"` here. Ink 5.2.1 drops
 * alternate rows when a clipped box overflows that way (a 4-row viewport
 * over 8 rows of content renders rows 1, 3, 5, 7); the `column-reverse`
 * form is clean. See `docs/lessons/message-list-scroll.md`.
 * @module @deepseek-ai/dsh-tui/components/MessageList
 */

import React, { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Box, Text, measureElement, useStdout, type DOMElement } from 'ink'
import type { UiEntry, UiState } from '../types.ts'
import { userMessageText } from '../types.ts'
import { windowStart } from '../scroll.ts'
import { Markdown } from './Markdown.tsx'

/** Props for {@link MessageList}. */
export interface MessageListProps {
  state: UiState
  /** Rows the view is lifted above the newest row; `0` follows the tail. */
  offset: number
  /** Mount the entire log because the user asked for its beginning. */
  pinTop: boolean
  /**
   * Report the measured content and viewport heights after each layout, so
   * the scroll hook can bound the offset against real rows.
   */
  onGeometry: (contentRows: number, viewportRows: number) => void
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

export const MessageList: FC<MessageListProps> = ({ state, offset, pinTop, onGeometry }) => {
  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 80
  const viewportRef = useRef<DOMElement | null>(null)
  const contentRef = useRef<DOMElement | null>(null)
  const [viewportRows, setViewportRows] = useState(0)

  // Mount the tail of the log plus enough history to cover the offset. The
  // window always reaches the newest entry, so the mounted content's bottom
  // edge is the log's bottom edge and the offset arithmetic stays exact.
  // `Home` overrides it: the beginning of the log is only reachable with
  // everything mounted.
  const start = pinTop
    ? 0
    : windowStart(state.entries, columns, offset, viewportRows || (stdout?.rows ?? 24))
  const visible = useMemo(() => state.entries.slice(start), [state.entries, start])

  // Measure after every layout. Both writes are guarded against no-ops —
  // `setViewportRows` by the comparison here, `onGeometry` inside the hook —
  // so this settles in one extra pass instead of looping. Coupling a
  // terminal UI to an unguarded re-render is the mistake recorded in
  // docs/lessons/prompt-scroll-snaps.md.
  useEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (viewport === null || content === null) {
      // Empty session: nothing is mounted and nothing can scroll.
      // Reporting zero is what collapses a stale offset back to the tail
      // after `/clear`.
      onGeometry(0, 0)
      return
    }
    const measuredViewport = measureElement(viewport).height
    const measuredContent = measureElement(content).height
    if (measuredViewport !== viewportRows) setViewportRows(measuredViewport)
    onGeometry(measuredContent, measuredViewport)
  })

  if (state.entries.length === 0) {
    // No empty-state copy: on an empty session the Banner is on screen
    // directly above, and its tip line already says how to start and
    // where the commands are. Keep only a single breathing row here: an
    // empty session should keep the prompt near the banner rather than
    // pushing it to the bottom of a tall terminal.
    return <Box height={1} />
  }

  return (
    <Box
      ref={viewportRef}
      flexDirection="column-reverse"
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      overflow="hidden"
      paddingX={1}
    >
      <Box ref={contentRef} flexDirection="column" flexShrink={0} marginBottom={-offset}>
        {visible.map((entry, idx) => (
          <Box key={start + idx} flexShrink={0}>
            <Entry entry={entry} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}
