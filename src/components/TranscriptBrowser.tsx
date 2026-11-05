import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, measureElement, type DOMElement } from 'ink'
import type { UiEntry } from '../core/types.ts'
import { entryText, searchTranscript } from '../commands/transcript.ts'
import { useStrings } from '../hooks/useStrings.tsx'
import { useTerminalEvent, useTerminalInput } from '../terminal/TerminalProvider.tsx'
import { visibleStart } from '../prompt/prompt-layout.ts'

export type MessageAction = 'jump' | 'copy' | 'inspect' | 'diff' | 'export'
export interface BrowserRequest { mode: 'search' | 'messages'; query: string; entries: readonly UiEntry[] }

/** A snapshot of the transcript prevents incoming events from changing the selected target. */
export function TranscriptBrowser({ request, onClose, onAction }: {
  request: BrowserRequest
  onClose: () => void
  onAction: (action: MessageAction, entry: UiEntry, index: number, path?: string, query?: string) => void
}) {
  const s = useStrings().browser
  const frame = useRef<DOMElement>(null)
  const [height, setHeight] = useState(6)
  useEffect(() => {
    if (frame.current) setHeight(measureElement(frame.current).height)
  })
  const [query, setQuery] = useState(request.query)
  const [selected, setSelected] = useState(0)
  const [target, setTarget] = useState<{ entry: UiEntry; index: number }>()
  const [exporting, setExporting] = useState(false)
  const [path, setPath] = useState('')
  const matches = useMemo(() => query.trim() ? searchTranscript(request.entries, query) :
    request.entries.flatMap((entry, index) => entry.kind === 'command' ? [] : [{ index, kind: entry.kind,
      preview: entryText(entry).replace(/\s+/g, ' ').slice(0, 180) }]).reverse(), [request.entries, query])
  const actions: MessageAction[] = ['jump', 'inspect', 'copy', 'diff', 'export']
  const length = target ? actions.length : matches.length
  const index = Math.min(selected, Math.max(0, length - 1))
  const edit = (text: string) => {
    const clean = text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    if (exporting) setPath(previous => previous + clean)
    else if (!target) { setQuery(previous => previous + clean); setSelected(0) }
  }
  useTerminalEvent((event) => { if (event.kind === 'paste-text') edit(event.text) })
  useTerminalInput((input, key) => {
    if (key.ctrl && input === 'c') { onClose(); return }
    if (key.escape) {
      if (exporting) { setExporting(false); setPath('') }
      else if (target) { setTarget(undefined); setSelected(0) }
      else onClose()
      return
    }
    if (key.upArrow || key.downArrow) {
      setSelected(Math.max(0, Math.min(length - 1, index + (key.upArrow ? -1 : 1))))
      return
    }
    if (key.backspace || key.delete) {
      if (exporting) setPath(previous => Array.from(previous).slice(0, -1).join(''))
      else if (!target) { setQuery(previous => Array.from(previous).slice(0, -1).join('')); setSelected(0) }
      return
    }
    if (key.return) {
      if (exporting && target && path.trim()) { onAction('export', target.entry, target.index, path.trim()); return }
      if (target) {
        const action = actions[index]
        if (action === 'export') setExporting(true)
        else onAction(action, target.entry, target.index)
      } else if (matches[index]) {
        const chosen = matches[index]
        const entry = request.entries[chosen.index]
        if (request.mode === 'search') onAction('jump', entry, chosen.index, undefined, query)
        else { setTarget({ entry, index: chosen.index }); setSelected(0) }
      }
      return
    }
    if (!key.ctrl && !key.meta && !key.tab) edit(input)
  })
  const rows = Math.max(1, Math.min(12, height - 5))
  const start = visibleStart(length, index, rows, 0)
  return <Box ref={frame} flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} overflow="hidden" paddingX={1}>
    <Box height={1} flexShrink={0}><Text bold color="cyan" wrap="truncate">{target ? `${s.actions} · ${target.index + 1}` : s[request.mode]}</Text></Box>
    <Box height={1} flexShrink={0}><Text wrap="truncate">{exporting ? `${s.path} ${path}▏` : target ? entryText(target.entry).replace(/\s+/g, ' ').slice(0, 180) : `${s.query} ${query}▏`}</Text></Box>
    <Box flexShrink={0} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {exporting ? <Text wrap="truncate">{s.exportHint}</Text> : length === 0 ? <Text>{s.empty}</Text> :
        Array.from({ length: Math.min(rows, length - start) }, (_, n) => {
          const i = start + n
          const match = matches[i]
          const text = target ? s[actions[i]] : `${match.index + 1}. ${match.kind} · ${match.preview}`
          const at = target || !query.trim() ? -1 : text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())
          return <Text key={i} wrap="truncate" backgroundColor={i === index ? 'cyan' : undefined}
            color={i === index ? 'black' : undefined} bold={i === index}>
            {at < 0 ? text : <>{text.slice(0, at)}
              <Text inverse bold>{text.slice(at, at + query.trim().length)}</Text>
              {text.slice(at + query.trim().length)}</>}
          </Text>
        })}
    </Box>
    <Box height={1} flexShrink={0}><Text dimColor wrap="truncate">{s.hint} · {length}</Text></Box>
  </Box>
}
