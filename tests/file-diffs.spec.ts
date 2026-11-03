import { expect, it } from 'vitest'
import { diffLines, recordedDiffs, transcriptDiffs } from '../src/render/file-diffs.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

it('renders changed lines with context and correct contextual hunk bounds', () => {
  const lines = diffLines({ path: 'file.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' })
  expect(lines).toEqual(['--- file.ts', '+++ file.ts', '@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c'])
  expect(diffLines({ path: 'file.ts', oldText: 'same', newText: 'same' })).toEqual([])
})
it('validates persisted diff metadata and includes nested PTC results', () => {
  const meta = { diffs: [{ path: 'a', oldText: null, newText: 'new' }, { path: 4, oldText: 4, newText: null }] }
  expect(recordedDiffs(meta)).toHaveLength(1)
  expect(transcriptDiffs([{ kind: 'tool', callId: ToolCallId('root'), name: 'run_code', args: '', turn: 1, step: 1,
    status: 'ok', subCalls: [{ subCallId: ToolCallId('nested'), name: 'write', args: '{}', status: 'ok', meta }] }])).toHaveLength(1)
})
