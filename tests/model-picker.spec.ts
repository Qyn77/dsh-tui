/**
 * Pure mechanics of the `/model ` picker: row mapping with the live model
 * marked, anchored query tokens, fill, filter, and the submitted line.
 *
 * @module @deepseek-ai/dsh-tui/tests/model-picker.spec
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
  { provider: 'deepseek-official', id: 'deepseek-r2', name: 'DeepSeek R2' },
]

const rows = modelRows(catalogue, undefined)

describe('modelMentionAt', () => {
  it('opens right after the anchoring space with an empty query', () => {
    expect(modelMentionAt('/model ', 7)).toEqual({ query: '', start: 7, end: 7 })
  })

  it('captures the whole token regardless of the caret inside it', () => {
    expect(modelMentionAt('/model deep', 9)).toEqual({ query: 'deep', start: 7, end: 11 })
  })

  it('closes once a second token exists', () => {
    expect(modelMentionAt('/model deep seek', 13)).toBeUndefined()
  })

  it('does not match a command that starts with the word', () => {
    expect(modelMentionAt('/models x', 8)).toBeUndefined()
  })
})

describe('modelCommandLine', () => {
  it('builds the full command line', () => {
    expect(modelCommandLine('deepseek-r2')).toBe('/model deepseek-r2')
  })
})

describe('applyModelMention', () => {
  it('replaces the token and leaves a trailing space', () => {
    const mention = modelMentionAt('/model dee', 9)
    expect(mention).toBeDefined()
    if (mention === undefined) return
    expect(applyModelMention('/model dee', mention, 'deepseek-v4')).toEqual({
      text: '/model deepseek-v4 ',
      cursor: 19,
    })
  })
})

describe('filterModelRows', () => {
  it('prefix-matches case-insensitively and keeps order', () => {
    expect(filterModelRows(rows, '').map(r => r.name))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4', 'deepseek-r2'])
    expect(filterModelRows(rows, 'DEEPSEEK-V4').map(r => r.name))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4'])
    expect(filterModelRows(rows, 'r2')).toEqual([])
  })
})

describe('modelRows', () => {
  it('uses bare ids as names and the provider display names as descriptions', () => {
    expect(rows[0]).toEqual({ name: 'deepseek-v4-flash', description: 'DeepSeek V4 Flash' })
  })

  it('marks only the model the session is on', () => {
    const marked = modelRows(catalogue, 'deepseek-v4')
    const ticked = marked.filter(r => r.description.startsWith(CURRENT_MODEL_GLYPH))
    expect(ticked).toHaveLength(1)
    expect(ticked[0]?.name).toBe('deepseek-v4')
    expect(ticked[0]?.description).toBe(`${CURRENT_MODEL_GLYPH} DeepSeek V4`)
  })
})
