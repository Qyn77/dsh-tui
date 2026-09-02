/**
 * The scrollable conversation area. Renders user messages, streaming
 * assistant text, tool calls, and lifecycle notes.
 *
 * Every entry kind draws through {@link Row}: a fixed-width marker column and
 * a body column beside it. That uniformity is deliberate — it keeps the left
 * edge of the conversation on one column no matter what an entry is, and it
 * gives wrapped text a hanging indent for free. The markers and the row costs
 * they imply live in `message-layout.ts`, which `scroll.ts` also reads.
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
import { useStrings } from '../hooks/useStrings.tsx'
import type { Catalog } from '../i18n.ts'
import {
  ASSISTANT_GLYPH,
  GUTTER_WIDTH,
  NOTE_GLYPH,
  RESULT_GLYPH,
  SHELL_GLYPH,
  USER_GLYPH,
  shellStatusKinds,
  toolCallSummary,
  toolResultSummary,
  toolStatusGlyph,
} from '../message-layout.ts'
import { SHELL_TIMEOUT_MS } from '../shell.ts'
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

/**
 * What one compaction stage says on screen.
 *
 * The three stages before the last collapse to one label deliberately: they are
 * internal phases of the same operation, and narrating them separately would
 * flicker three different sentences through one row while nothing the user can
 * act on changes.
 */
function compactionLabel(
  stage: Extract<UiEntry, { kind: 'compaction' }>['stage'],
  strings: Catalog,
): string {
  return stage === 'end' ? strings.entries.compactionDone : strings.entries.compacting
}


/**
 * One entry, drawn as a fixed-width marker column beside a body column.
 *
 * The two-column form is what gives wrapped text a hanging indent: a long
 * assistant turn or a long tool path continues under the body, never back
 * under the marker. `flexShrink={0}` on the marker keeps that true at narrow
 * widths, where Ink would otherwise borrow the cells it needs from the
 * narrowest column first.
 *
 * `marginTop` separates one entry from the next. It goes on the top rather
 * than the bottom so a tool call's outcome, which lives inside the same row,
 * stays welded to the call it belongs to.
 */
function Row({
  glyph,
  color,
  dim = false,
  children,
}: {
  glyph: string
  color?: string
  dim?: boolean
  children: React.ReactNode
}) {
  return (
    <Box marginTop={1}>
      <Box width={GUTTER_WIDTH} flexShrink={0}>
        <Text color={color} dimColor={dim}>{glyph}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  )
}

/**
 * A tool call: the invocation on one row, its outcome hanging below.
 *
 * The round-bordered card this replaced cost four rows of frame before any
 * content and pushed the conversation's own indentation two columns right. A
 * transcript is mostly tool calls, so their per-entry overhead sets how much
 * real conversation fits on screen.
 */
function ToolCall({ entry }: { entry: Extract<UiEntry, { kind: 'tool' }> }) {
  // `cancelled` is gray rather than red: the call did not fail, it never
  // finished. Painting it red would report a problem the tool never had.
  const color = entry.status === 'error'
    ? 'red'
    : entry.status === 'ok'
      ? 'green'
      : entry.status === 'cancelled'
        ? 'gray'
        : 'yellow'
  const result = entry.result ? toolResultSummary(entry.result) : ''
  return (
    <Row glyph={ASSISTANT_GLYPH} color={color}>
      <Text>
        <Text bold>{toolCallSummary(entry.name, entry.args)}</Text>
        <Text color={color}> {toolStatusGlyph(entry.status)}</Text>
      </Text>
      {entry.error !== undefined ? (
        <Text color="red">
          {RESULT_GLYPH} {entry.error.name}: {entry.error.code}
        </Text>
      ) : result !== '' ? (
        <Text dimColor>
          {RESULT_GLYPH} {result}
        </Text>
      ) : null}
    </Row>
  )
}

function AssistantBlock({ entry }: { entry: Extract<UiEntry, { kind: 'assistant' }> }) {
  const strings = useStrings()
  // While the turn is still streaming, show raw text — re-parsing
  // partial markdown on every chunk risks a half-open fence or an
  // italic delimiter that hasn't closed yet, both of which would
  // churn the layout. Once the turn finalizes we re-render the full
  // block as markdown. The transition fires on the assistant/message
  // event, not on a timer, so it doesn't trigger the scroll-snap
  // regression that lives in `docs/lessons/prompt-scroll-snaps.md`.
  return (
    <Row glyph={ASSISTANT_GLYPH} color="magenta">
      <Text>
        <Text color="magenta" bold>{strings.entries.assistant}</Text>
        <Text color="gray">{strings.entries.turnStep(entry.turn, entry.step)}</Text>
        {!entry.finalized && <Text color="yellow">{strings.entries.streaming}</Text>}
      </Text>
      {entry.finalized ? (
        <Markdown source={entry.text} />
      ) : (
        <Text>{entry.text || ' '}</Text>
      )}
    </Row>
  )
}

function UserBlock({ entry }: { entry: Extract<UiEntry, { kind: 'user' }> }) {
  // No `you` label: the marker already says whose line this is, and a user
  // message carries no metadata to hang off a header row. Dropping it puts
  // the text itself on the marker's row and saves a row per turn.
  return (
    <Row glyph={USER_GLYPH} color="blue">
      <Text>{userMessageText(entry.message) || ' '}</Text>
    </Row>
  )
}

/**
 * A side remark. Dim gray by default — these are incidental.
 *
 * A toned note is not incidental and must not read as one: a failed turn is
 * red and a turn that was stopped is yellow, both at full brightness. Left
 * dim they were indistinguishable from a compaction notice, which is the
 * wrong weight for the two outcomes the user most needs to see.
 */
function NoteLine({ entry }: { entry: Extract<UiEntry, { kind: 'note' }> }) {
  const color = entry.tone === 'error' ? 'red' : entry.tone === 'warn' ? 'yellow' : 'gray'
  const dim = entry.tone === undefined
  return (
    <Row glyph={NOTE_GLYPH} color={color} dim={dim}>
      <Text color={color} dimColor={dim}>{entry.text}</Text>
    </Row>
  )
}

function CompactionLine({ entry }: { entry: Extract<UiEntry, { kind: 'compaction' }> }) {
  const strings = useStrings()
  return (
    <Row glyph={NOTE_GLYPH} color="cyan" dim>
      <Text color="cyan" dimColor>{compactionLabel(entry.stage, strings)}</Text>
    </Row>
  )
}

function PlanLine({ entry }: { entry: Extract<UiEntry, { kind: 'plan' }> }) {
  const strings = useStrings()
  return (
    <Row glyph={NOTE_GLYPH} color={entry.enabled ? 'yellow' : 'gray'} dim>
      <Text color={entry.enabled ? 'yellow' : 'gray'}>
        {strings.entries.planMode(entry.enabled)}
      </Text>
    </Row>
  )
}

function RuntimeContextLine({ entry }: { entry: Extract<UiEntry, { kind: 'runtime-context' }> }) {
  const strings = useStrings()
  // Header carries the producer and form so the user can see which
  // plugin injected this context (e.g. agent-instructions shipping a
  // <system-reminder>). The preview is a short, dimmed sample of the
  // payload — full text would crowd the chat surface.
  //
  // The producer's name and the form stay untranslated: both are identifiers
  // the plugin chose, and renaming another package's `form` in our own UI
  // would leave the user unable to match what they see against that package's
  // documentation.
  const header = `${strings.entries.runtimeContext}${entry.plugin ? ` · ${entry.plugin}` : ''}${entry.form ? ` (${entry.form})` : ''}`
  return (
    <Row glyph={NOTE_GLYPH} color="gray" dim>
      <Text color="gray" dimColor>{header}</Text>
      {entry.preview !== '' && (
        <Text color="gray" dimColor>{entry.preview}</Text>
      )}
    </Row>
  )
}

/**
 * A slash command and its output.
 *
 * The output is drawn in the default foreground rather than dimmed. Unlike a
 * note or a tool result this is content the user explicitly asked for, and the
 * `gray dim` used for incidental rows makes a `/help` table hard to read on a
 * light terminal. Only the echoed command line carries the brand color, which
 * is the same `cyan` the slash palette uses for command names.
 */
function CommandLine({ entry }: { entry: Extract<UiEntry, { kind: 'command' }> }) {
  const color = entry.failed ? 'red' : 'cyan'
  return (
    <Row glyph={NOTE_GLYPH} color={color}>
      <Text color={color}>{entry.input}</Text>
      {entry.text !== '' && (
        <Text color={entry.failed ? 'red' : undefined}>{entry.text}</Text>
      )}
    </Row>
  )
}

/**
 * A `!` shell escape: the echoed command, the program's own output, and at most
 * one status row.
 *
 * The status row is `wrap="truncate"`, deliberately. It is the only row here
 * whose text depends on the language, and `scroll.ts` has to know how tall this
 * entry is without knowing which catalog is loaded. Truncating pins it at one
 * row in every language and at every width, which is what keeps the measured
 * height and the drawn height equal — the agreement paging depends on.
 */
function ShellLine({ entry }: { entry: Extract<UiEntry, { kind: 'shell' }> }) {
  const strings = useStrings()
  const failed = entry.timedOut || entry.signal !== undefined || (entry.exitCode ?? 1) !== 0
  const color = failed ? 'red' : 'cyan'
  const status = shellStatusKinds(entry).map((kind) => {
    switch (kind) {
      case 'timedOut':
        return strings.shell.timedOut(Math.round(SHELL_TIMEOUT_MS / 1000))
      case 'signalled':
        return strings.shell.signalled(entry.signal ?? '')
      case 'exit':
        return strings.shell.exit(entry.exitCode ?? 0)
      case 'truncated':
        return strings.shell.truncated
      case 'injected':
        return strings.shell.injected
      default: {
        const _exhaustive: never = kind
        return String(_exhaustive)
      }
    }
  })
  return (
    <Row glyph={SHELL_GLYPH} color={color}>
      <Text color={color}>{entry.command}</Text>
      {entry.output !== '' && <Text>{entry.output}</Text>}
      {status.length > 0 && (
        <Text color={failed ? 'red' : 'gray'} dimColor={!failed} wrap="truncate">
          {status.join(' · ')}
        </Text>
      )}
    </Row>
  )
}

function Entry({ entry }: { entry: UiEntry }) {  switch (entry.kind) {
  case 'user':
    return <UserBlock entry={entry} />
  case 'assistant':
    return <AssistantBlock entry={entry} />
  case 'tool':
    return <ToolCall entry={entry} />
  case 'note':
    return <NoteLine entry={entry} />
  case 'compaction':
    return <CompactionLine entry={entry} />
  case 'plan':
    return <PlanLine entry={entry} />
  case 'runtime-context':
    return <RuntimeContextLine entry={entry} />
  case 'command':
    return <CommandLine entry={entry} />
  case 'shell':
    return <ShellLine entry={entry} />
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
