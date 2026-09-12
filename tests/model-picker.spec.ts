/**
 * Pure mechanics of the `/model ` picker: row mapping across providers with
 * the live route marked, anchored query tokens, fill, filter, and the
 * submitted line.
 *
 * @module @qiao-qyn/dsh-tui/tests/model-picker.spec
 */

import { describe, expect, it } from 'vitest'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import {
  CURRENT_MODEL_GLYPH,
  applyModelMention,
  filterModelRows,
  modelCommandLine,
  modelMentionAt,
  modelRows,
} from '../src/pickers/model-picker.ts'

const catalogue: readonly LlmModelInfo[] = [
  { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { provider: 'deepseek-official', id: 'deepseek-v4', name: 'DeepSeek V4' },
  { provider: 'openai-gateway', id: 'deepseek-v4', name: 'DeepSeek V4 (via gateway)' },
]

const providerName = (provider: string): string =>
  provider === 'deepseek-official' ? 'DeepSeek' : 'OpenAI'

const rows = modelRows(catalogue, undefined, providerName)

describe('modelMentionAt', () => {
  it('opens right after the anchoring space with an empty query', () => {
    expect(modelMentionAt('/model ', 7)).toEqual({ query: '', start: 7, end: 7 })
  })

  it('captures the whole token regardless of the caret inside it', () => {
    expect(modelMentionAt('/model deep', 9)).toEqual({ query: 'deep', start: 7, end: 11 })
  })

  it('captures a qualified token as one unit', () => {
    expect(modelMentionAt('/model openai-gateway/deepseek-v4', 20))
      .toEqual({ query: 'openai-gateway/deepseek-v4', start: 7, end: 33 })
  })

  it('closes once a second token exists', () => {
    expect(modelMentionAt('/model deep seek', 13)).toBeUndefined()
  })

  it('does not match a command that starts with the word', () => {
    expect(modelMentionAt('/models x', 8)).toBeUndefined()
  })
})

describe('modelCommandLine', () => {
  it('builds the full command line from a qualified name', () => {
    expect(modelCommandLine('openai-gateway/deepseek-v4')).toBe('/model openai-gateway/deepseek-v4')
  })
})

describe('applyModelMention', () => {
  it('replaces the token and leaves a trailing space', () => {
    const mention = modelMentionAt('/model dee', 9)
    expect(mention).toBeDefined()
    if (mention === undefined) return
    expect(applyModelMention('/model dee', mention, 'deepseek-official/deepseek-v4')).toEqual({
      text: '/model deepseek-official/deepseek-v4 ',
      cursor: 37,
    })
  })
})

describe('filterModelRows', () => {
  it('prefix-matches the qualified name case-insensitively and keeps order', () => {
    expect(filterModelRows(rows, 'DEEPSEEK-OFFICIAL').map(r => r.name))
      .toEqual(['deepseek-official/deepseek-v4-flash', 'deepseek-official/deepseek-v4'])
  })

  it('prefix-matches the model half alone, so a provider name is no tax', () => {
    expect(filterModelRows(rows, 'deepseek-v4').map(r => r.name))
      .toEqual([
        'deepseek-official/deepseek-v4-flash',
        'deepseek-official/deepseek-v4',
        'openai-gateway/deepseek-v4',
      ])
  })

  it('keeps every row on an empty query', () => {
    expect(filterModelRows(rows, '')).toEqual(rows)
  })
})

describe('modelRows', () => {
  it('names each row by the qualified route and describes it with both halves', () => {
    expect(rows[0]).toEqual({
      name: 'deepseek-official/deepseek-v4-flash',
      description: 'DeepSeek V4 Flash · DeepSeek',
    })
  })

  it('keeps same-id models from different providers apart', () => {
    const names = rows.map(r => r.name)
    expect(names).toContain('deepseek-official/deepseek-v4')
    expect(names).toContain('openai-gateway/deepseek-v4')
  })

  it('marks only the exact route the session is on', () => {
    const marked = modelRows(catalogue, { provider: 'openai-gateway', model: 'deepseek-v4' }, providerName)
    const ticked = marked.filter(r => r.description.startsWith(CURRENT_MODEL_GLYPH))
    expect(ticked).toHaveLength(1)
    expect(ticked[0]?.name).toBe('openai-gateway/deepseek-v4')
    expect(ticked[0]?.description).toBe(`${CURRENT_MODEL_GLYPH} DeepSeek V4 (via gateway) · OpenAI`)
  })

  it('ticks nothing when the selection names no listed route', () => {
    const marked = modelRows(catalogue, { provider: 'gone', model: 'ghost' }, providerName)
    expect(marked.some(r => r.description.startsWith(CURRENT_MODEL_GLYPH))).toBe(false)
  })
})
