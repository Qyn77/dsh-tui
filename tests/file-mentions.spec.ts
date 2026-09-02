/**
 * The `@` mention: what counts as one, how paths are ranked against it, and
 * what the buffer looks like afterwards.
 *
 * The trigger rule is the part worth pinning hardest. A picker that opens on
 * every `@` fires on email addresses and npm scopes mid-sentence, and a picker
 * that steals ↑/↓ when the user is writing prose is worse than no picker.
 * @module @deepseek-ai/dsh-tui/tests/file-mentions.spec
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyMention,
  listFiles,
  mentionAt,
  rankPaths,
  scorePath,
} from '../src/file-mentions.ts'

describe('mentionAt', () => {
  it('finds a mention the caret is typing at the end of', () => {
    expect(mentionAt('look at @src/pro', 16)).toEqual({ query: 'src/pro', start: 8, end: 16 })
  })

  it('opens on a bare @, because that is the whole list', () => {
    expect(mentionAt('@', 1)).toEqual({ query: '', start: 0, end: 1 })
  })

  it('ignores an @ that does not open a word', () => {
    // An email address, an npm scope in prose, a git ref — none of them are a
    // request for a file list.
    expect(mentionAt('mail me at qiao@example.com', 27)).toBeUndefined()
    expect(mentionAt('install react@18', 16)).toBeUndefined()
  })

  it('ignores a caret sitting outside any mention', () => {
    expect(mentionAt('@src/a and more', 12)).toBeUndefined()
    expect(mentionAt('plain text', 5)).toBeUndefined()
  })

  it('covers the whole token, not just the part before the caret', () => {
    // Completing from the middle must replace the tail too, or the old
    // suffix is left stranded after the inserted path.
    expect(mentionAt('@src/prompt.ts', 5)).toEqual({
      query: 'src/prompt.ts', start: 0, end: 14,
    })
  })

  it('stops at a space, since a path with one cannot be completed anyway', () => {
    expect(mentionAt('@src and @lib', 13)).toEqual({ query: 'lib', start: 9, end: 13 })
  })
})

describe('applyMention', () => {
  it('replaces the token and leaves a trailing space', () => {
    const buffer = 'read @src/pro'
    const mention = mentionAt(buffer, buffer.length)!
    expect(applyMention(buffer, mention, 'src/prompt-layout.ts')).toEqual({
      text: 'read @src/prompt-layout.ts ',
      cursor: 27,
    })
  })

  it('keeps whatever followed the mention', () => {
    const buffer = 'read @src/pro and stop'
    const mention = mentionAt(buffer, 13)!
    const next = applyMention(buffer, mention, 'src/prompt.ts')
    expect(next.text).toBe('read @src/prompt.ts  and stop')
    // The caret lands after the inserted space, before the old one.
    expect(next.cursor).toBe(20)
  })
})

describe('scorePath', () => {
  it('rejects a path that does not contain the query as a subsequence', () => {
    expect(scorePath('src/prompt.ts', 'zz')).toBeUndefined()
  })

  it('matches a scattered subsequence, which is what makes it fuzzy', () => {
    expect(scorePath('src/components/MessageList.tsx', 'mlx')).toBeDefined()
  })

  it('prefers a hit in the basename over one in a directory', () => {
    const inName = scorePath('a/b/prompt.ts', 'prompt')!
    const inDir = scorePath('prompt/b/other.ts', 'prompt')!
    expect(inName).toBeGreaterThan(inDir)
  })

  it('prefers a contiguous run over scattered letters', () => {
    const run = scorePath('src/scroll.ts', 'scr')!
    const scattered = scorePath('s/c/r.ts', 'scr')!
    expect(run).toBeGreaterThan(scattered)
  })
})

describe('rankPaths', () => {
  const paths = ['src/scroll.ts', 'src/state.ts', 'tests/scroll.spec.ts']

  it('returns the shallower file first when nothing else separates them', () => {
    // Listing order carries the breadth-first walk's depth information, so a
    // tie is broken towards the file the user is more likely to mean.
    expect(rankPaths(paths, 'scroll', 5)[0]).toBe('src/scroll.ts')
  })

  it('spends the query on the filename before the directories', () => {
    // The failure this pins: a leftmost-first scan matches `s`, `c`, `r`
    // against three directory names and calls that a better hit than the
    // filename the user is plainly typing.
    expect(rankPaths(['s/c/r.ts', 'src/scroll.ts'], 'scr', 5)[0]).toBe('src/scroll.ts')
  })

  it('drops non-matches entirely', () => {
    expect(rankPaths(paths, 'state', 5)).toEqual(['src/state.ts'])
  })

  it('hands back the whole list for an empty query', () => {
    expect(rankPaths(paths, '', 5)).toEqual(paths)
  })

  it('never returns more than the limit', () => {
    expect(rankPaths(paths, '', 2)).toHaveLength(2)
  })
})

describe('listFiles', () => {
  /** A small tree with the two things the walk is supposed to refuse. */
  async function fixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mentions-'))
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'node_modules', 'left'), { recursive: true })
    await mkdir(join(root, '.git'), { recursive: true })
    await writeFile(join(root, 'top.md'), '')
    await writeFile(join(root, 'src', 'deep.ts'), '')
    await writeFile(join(root, 'node_modules', 'left', 'index.js'), '')
    await writeFile(join(root, '.git', 'HEAD'), '')
    return root
  }

  it('walks breadth-first, so shallow files come first', async () => {
    const files = await listFiles(await fixture())
    expect(files).toEqual(['top.md', 'src/deep.ts'])
  })

  it('refuses node_modules and dotted directories', async () => {
    const files = await listFiles(await fixture())
    expect(files.some(path => path.includes('node_modules'))).toBe(false)
    expect(files.some(path => path.includes('.git'))).toBe(false)
  })

  it('stops at the limit rather than walking a whole disk', async () => {
    expect(await listFiles(await fixture(), 1)).toHaveLength(1)
  })

  it('returns an empty list for a directory that is not there', async () => {
    // A `!cd` into a directory that is later removed must not take the
    // picker — or the app — down with it.
    expect(await listFiles(join(tmpdir(), 'dsh-does-not-exist-9182'))).toEqual([])
  })
})
