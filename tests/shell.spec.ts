/**
 * Parsing rules for the `!` shell escape. No subprocess, no `chdir` — every
 * assertion here is a string or a path calculation, which is the point of
 * keeping `shell.ts` free of I/O.
 */

import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { clampOutput, parseCd, parseShellInput, resolveCd } from '../src/shell.ts'

describe('parseShellInput', () => {
  it('ignores lines that are not escapes', () => {
    expect(parseShellInput('ls')).toBeUndefined()
    expect(parseShellInput('/help')).toBeUndefined()
    expect(parseShellInput('what does ! mean')).toBeUndefined()
  })

  it('reads `!` as view-only and `!!` as injected', () => {
    expect(parseShellInput('!ls -la')).toEqual({ command: 'ls -la', inject: false })
    expect(parseShellInput('!!git status')).toEqual({ command: 'git status', inject: true })
  })

  it('tests the longer sigil first', () => {
    // Checked the other way round, `!!ls` would run the command `!ls`.
    expect(parseShellInput('!!ls')?.command).toBe('ls')
  })

  it('tolerates space around the sigil and the command', () => {
    expect(parseShellInput('  !  ls  ')).toEqual({ command: 'ls', inject: false })
  })

  it('reports a bare sigil as an empty command', () => {
    expect(parseShellInput('!')).toEqual({ command: '', inject: false })
    expect(parseShellInput('!!  ')).toEqual({ command: '', inject: true })
  })
})

describe('parseCd', () => {
  it('recognizes the bare and home forms', () => {
    expect(parseCd('cd')).toEqual({ kind: 'home' })
    expect(parseCd('cd ~')).toEqual({ kind: 'home' })
    expect(parseCd('  cd   ')).toEqual({ kind: 'home' })
  })

  it('recognizes `cd -`', () => {
    expect(parseCd('cd -')).toEqual({ kind: 'previous' })
  })

  it('recognizes a single operand and unquotes it', () => {
    expect(parseCd('cd src')).toEqual({ kind: 'path', path: 'src' })
    expect(parseCd('cd ~/work')).toEqual({ kind: 'path', path: '~/work' })
    expect(parseCd('cd "my dir"')).toEqual({ kind: 'path', path: 'my dir' })
  })

  it('leaves compound and multi-operand lines to the shell', () => {
    // Their directory change dies with the child, exactly as in a shell script.
    expect(parseCd('cd src && ls')).toBeUndefined()
    expect(parseCd('cd -P /tmp')).toBeUndefined()
    expect(parseCd('cd; pwd')).toBeUndefined()
  })

  it('does not match commands that merely start with the letters', () => {
    expect(parseCd('cdk deploy')).toBeUndefined()
    expect(parseCd('echo cd')).toBeUndefined()
  })
})

describe('resolveCd', () => {
  const cwd = resolve('/tmp/project')

  it('resolves a relative path against the current directory', () => {
    expect(resolveCd({ kind: 'path', path: 'src' }, { cwd }))
      .toBe(resolve(cwd, 'src'))
    expect(resolveCd({ kind: 'path', path: '..' }, { cwd }))
      .toBe(resolve(cwd, '..'))
  })

  it('keeps an absolute path as given', () => {
    const absolute = resolve('/usr/local')
    expect(resolveCd({ kind: 'path', path: absolute }, { cwd })).toBe(absolute)
  })

  it('expands a leading `~` only when it is the whole segment', () => {
    const home = resolve('/home/dev')
    expect(resolveCd({ kind: 'home' }, { cwd, home })).toBe(home)
    expect(resolveCd({ kind: 'path', path: '~/work' }, { cwd, home }))
      .toBe(resolve(home, 'work'))
    // Another account's home is not ours to look up, and `~backup` is a filename.
    expect(resolveCd({ kind: 'path', path: '~other/work' }, { cwd, home }))
      .toBe(resolve(cwd, '~other/work'))
  })

  it('has nowhere to go without a home or a previous directory', () => {
    expect(resolveCd({ kind: 'home' }, { cwd })).toBeUndefined()
    expect(resolveCd({ kind: 'previous' }, { cwd })).toBeUndefined()
    expect(resolveCd({ kind: 'previous' }, { cwd, previous: '/old' })).toBe('/old')
  })
})

describe('clampOutput', () => {
  it('passes output that fits through untouched', () => {
    expect(clampOutput('hello', 64)).toEqual({ text: 'hello', truncated: false })
  })

  it('keeps the head, because the cause is above the summary', () => {
    expect(clampOutput('abcdefgh', 3)).toEqual({ text: 'abc', truncated: true })
  })

  it('measures bytes, not characters', () => {
    // Three characters, nine UTF-8 bytes: a character-based cap would let this
    // through and a byte-based one must not.
    expect(clampOutput('中文字', 9).truncated).toBe(false)
    expect(clampOutput('中文字', 8).truncated).toBe(true)
  })

  it('never leaves a split code point behind', () => {
    // Cutting '中文' at 4 bytes lands mid-character; the half must be dropped
    // rather than shown as U+FFFD, which would read as command output.
    expect(clampOutput('中文', 4)).toEqual({ text: '中', truncated: true })
  })
})
