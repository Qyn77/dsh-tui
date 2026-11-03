import { expect, it } from 'vitest'
import type { UiEntry } from '../src/core/types.ts'
import { entryNumber, entryText, searchTranscript, transcriptMarkdown } from '../src/commands/transcript.ts'
const entries: UiEntry[] = [
  { kind: 'assistant', turn: 1, step: 1, text: '中文结果 Mixed CASE', finalized: true },
  { kind: 'command', input: '/search 结果', text: 'old results', failed: false },
  { kind: 'shell', command: 'echo test', output: '````\n结果', exitCode: 0, timedOut: false, truncated: false, injected: false },
]
it('searches full text case-insensitively without searching its own results', () => {
  expect(searchTranscript(entries, '结果').map(match => match.index)).toEqual([0, 2])
  expect(searchTranscript(entries, 'mixed case').map(match => match.index)).toEqual([0])
  expect(searchTranscript(entries, '')).toEqual([])
})
it('validates one-based entry numbers without truncation or wrapping', () => {
  expect(entryNumber('1', 3)).toBe(0)
  for (const value of ['0', '-1', '1.2', '4', 'Infinity', '9007199254740993']) expect(entryNumber(value, 3)).toBeUndefined()
})
it('exports complete content including literal Markdown fences in tool output', () => {
  expect(entryText(entries[2])).toContain('````\n结果')
  expect(transcriptMarkdown(entries)).toContain('`````text\necho test\n````\n结果\n`````')
  expect(transcriptMarkdown(entries)).toContain('中文结果 Mixed CASE')
})

it('navigates matching results and previous user/tool/error entries', async () => {
  const { navigationIndex } = await import('../src/commands/transcript.ts')
  const rows: UiEntry[] = [...entries, { kind: 'note', text: 'failed', tone: 'error' }]
  expect(navigationIndex('next', rows, 0, [0, 2])).toBe(2)
  expect(navigationIndex('next', rows, 2, [0, 2])).toBe(0)
  expect(navigationIndex('prev', rows, 0, [0, 2])).toBe(2)
  expect(navigationIndex('error', rows)).toBe(3)
  expect(navigationIndex('tool', rows)).toBeUndefined()
})
