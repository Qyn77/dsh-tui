/**
 * Environment probing. The git parsers are pure and carry the tests;
 * `readRepoLabel` is the impure entry point and is exercised only for
 * its "never throws" contract, since its result depends on the machine
 * the suite runs on.
 */

import { describe, expect, it } from 'vitest'
import {
  parseGitBranch,
  parseGitDirty,
  formatRepoLabel,
  readRepoLabel,
  VERSION,
} from '../src/environment.ts'

/** A realistic porcelain-v2 header block for a clean checkout. */
const CLEAN = [
  '# branch.oid 947bec8c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
].join('\n')

describe('parseGitBranch', () => {
  it('reads the branch name from the porcelain header', () => {
    expect(parseGitBranch(CLEAN)).toBe('main')
  })

  it('handles a branch name containing slashes', () => {
    expect(parseGitBranch('# branch.head feat/slash-palette')).toBe('feat/slash-palette')
  })

  it('returns undefined for a detached HEAD', () => {
    // Porcelain v2 spells this as the literal `(detached)`, which is
    // not a branch name worth putting in the banner.
    expect(parseGitBranch('# branch.head (detached)')).toBeUndefined()
  })

  it('returns undefined when the header is absent', () => {
    expect(parseGitBranch('')).toBeUndefined()
    expect(parseGitBranch('fatal: not a git repository')).toBeUndefined()
  })

  it('returns undefined when the header is present but empty', () => {
    expect(parseGitBranch('# branch.head ')).toBeUndefined()
  })
})

describe('parseGitDirty', () => {
  it('is false when the output is only headers', () => {
    expect(parseGitDirty(CLEAN)).toBe(false)
  })

  it('is true when a tracked file is modified', () => {
    expect(parseGitDirty(`${CLEAN}\n1 .M N... 100644 100644 100644 abc def src/x.ts`)).toBe(true)
  })

  it('is true when an untracked file is present', () => {
    expect(parseGitDirty(`${CLEAN}\n? scratch.mjs`)).toBe(true)
  })

  it('is false for empty output', () => {
    expect(parseGitDirty('')).toBe(false)
  })
})

describe('formatRepoLabel', () => {
  it('returns the bare branch for a clean tree', () => {
    expect(formatRepoLabel('main', false)).toBe('main')
  })

  it('appends the conventional * marker when dirty', () => {
    expect(formatRepoLabel('main', true)).toBe('main*')
  })

  it('returns undefined without a branch, dirty or not', () => {
    // Outside a repo there is nothing to label, so the banner omits
    // the whole parenthetical rather than showing a bare `*`.
    expect(formatRepoLabel(undefined, false)).toBeUndefined()
    expect(formatRepoLabel(undefined, true)).toBeUndefined()
  })
})

describe('readRepoLabel', () => {
  it('never throws, whatever the machine looks like', () => {
    // The suite may run inside a repo, outside one, or on a box with
    // no git at all. All three must return, not throw.
    expect(() => readRepoLabel()).not.toThrow()
  })

  it('is memoized, so a re-render costs no second subprocess', () => {
    expect(readRepoLabel()).toBe(readRepoLabel())
  })
})

describe('VERSION', () => {
  it('falls back to `dev` when no build-time define applied', () => {
    // vitest runs the source, not the bundle, so the tsdown define is
    // absent here. The `typeof` guard is what keeps this from being a
    // ReferenceError.
    expect(VERSION).toBe('dev')
  })
})
