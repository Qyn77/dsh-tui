/**
 * The preference file's contract.
 *
 * The pure half (`parseSettings`, `mergeSettings`) is tested directly; the two
 * impure entry points are tested against a temporary directory standing in for
 * `$HOME`, because the properties that matter — an unwritable home does not
 * throw, unknown keys survive a round trip — are properties of real filesystem
 * calls rather than of the parsing.
 * @module @deepseek-ai/dsh-tui/tests/settings
 */

import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  parseSettings,
  readSettings,
  settingsPath,
  writeSettings,
} from '../src/settings.ts'

/** Temp homes created by a test, removed afterwards. */
const homes: string[] = []

function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-tui-settings-'))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()
    if (home === undefined) continue
    // A test may have made the directory read-only to provoke a write
    // failure; put it back so the cleanup itself can succeed.
    try {
      chmodSync(join(home, '.dsh'), 0o755)
    } catch {
      // Never existed, which is the common case.
    }
    rmSync(home, { recursive: true, force: true })
  }
})

describe('parseSettings', () => {
  it('reads a stored language', () => {
    expect(parseSettings('{"language":"zh"}')).toEqual({ language: 'zh', theme: 'auto', history: 'show' })
  })

  it('reads a stored theme preference', () => {
    expect(parseSettings('{"theme":"light"}').theme).toBe('light')
    expect(parseSettings('{"theme":"auto"}').theme).toBe('auto')
  })

  it('treats an unrecognized theme as absent', () => {
    // Same rule as an unrecognized language: it is what lets an older build
    // read a file a newer one wrote, rather than refusing to start.
    expect(parseSettings('{"theme":"solarized"}').theme).toBe(DEFAULT_SETTINGS.theme)
    expect(parseSettings('{"theme":4}').theme).toBe(DEFAULT_SETTINGS.theme)
  })

  it('reads a stored history preference', () => {
    expect(parseSettings('{"history":"hide"}').history).toBe('hide')
    expect(parseSettings('{"history":"show"}').history).toBe('show')
  })

  it('treats an unrecognized history preference as absent', () => {
    // Same forward-compatibility rule as the theme and the language.
    expect(parseSettings('{"history":"maybe"}').history).toBe(DEFAULT_SETTINGS.history)
    expect(parseSettings('{"history":0}').history).toBe(DEFAULT_SETTINGS.history)
  })

  it('reads the keys independently', () => {
    expect(parseSettings('{"language":"zh"}').theme).toBe('auto')
    expect(parseSettings('{"theme":"dark"}').language).toBe('en')
    expect(parseSettings('{"history":"hide"}').language).toBe('en')
  })

  it('defaults when there is no file', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults on malformed JSON rather than throwing', () => {
    // Hand-edited badly, or truncated by a crash mid-write. Neither is a
    // reason for the terminal to refuse to open.
    expect(parseSettings('{"language":')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults when the JSON is not an object', () => {
    // `typeof null === 'object'` is the trap here; a bare scalar is the
    // other one.
    for (const raw of ['null', '4', '"zh"', '[]', 'true']) {
      expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('defaults on a language code it does not recognize', () => {
    // This is what lets an older build read a file a newer one wrote: the
    // unknown value is treated as absent, not as a fatal mismatch.
    expect(parseSettings('{"language":"fr"}')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{"language":42}')).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores keys it does not know', () => {
    expect(parseSettings('{"language":"zh","future":{"a":1}}'))
      .toEqual({ language: 'zh', theme: 'auto', history: 'show' })
  })
})

describe('mergeSettings', () => {
  it('writes a fresh file when there was none', () => {
    expect(JSON.parse(mergeSettings(undefined, { language: 'zh' }))).toEqual({ language: 'zh' })
  })

  it('preserves keys this version does not know', () => {
    // The `~/.dsh` directory is shared with the launcher and with future
    // versions of this package. `/language` must not be what deletes their
    // settings.
    const next = mergeSettings('{"language":"en","future":{"a":1}}', { language: 'zh' })
    expect(JSON.parse(next)).toEqual({ language: 'zh', future: { a: 1 } })
  })

  it('replaces an unusable file rather than propagating it', () => {
    expect(JSON.parse(mergeSettings('not json at all', { language: 'zh' }))).toEqual({
      language: 'zh',
    })
  })

  it('ends with a newline', () => {
    // Someone will `cat` this file.
    expect(mergeSettings(undefined, { language: 'en' }).endsWith('\n')).toBe(true)
  })
})

describe('readSettings', () => {
  it('defaults when the home has no .dsh directory', () => {
    expect(readSettings(fakeHome())).toEqual(DEFAULT_SETTINGS)
  })

  it('reads what writeSettings wrote', () => {
    const home = fakeHome()
    expect(writeSettings({ language: 'zh', history: 'hide' }, home)).toBe(true)
    expect(readSettings(home)).toEqual({ language: 'zh', theme: 'auto', history: 'hide' })
  })

  it('defaults when the path is a directory rather than a file', () => {
    const home = fakeHome()
    mkdirSync(settingsPath(home), { recursive: true })
    expect(readSettings(home)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('writeSettings', () => {
  it('creates ~/.dsh when it does not exist yet', () => {
    const home = fakeHome()
    expect(writeSettings({ language: 'zh' }, home)).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath(home), 'utf8'))).toEqual({ language: 'zh' })
  })

  it('keeps unknown keys across a round trip on disk', () => {
    const home = fakeHome()
    mkdirSync(join(home, '.dsh'), { recursive: true })
    writeFileSync(settingsPath(home), '{"language":"en","launcher":{"theme":"dark"}}\n')
    expect(writeSettings({ language: 'zh' }, home)).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath(home), 'utf8'))).toEqual({
      language: 'zh',
      launcher: { theme: 'dark' },
    })
  })

  it('reports failure instead of throwing when the directory is unwritable', () => {
    // The switch has already happened on screen by the time this runs. A
    // read-only home means the preference does not outlive the session — it
    // does not mean the command failed.
    const home = fakeHome()
    mkdirSync(join(home, '.dsh'), { recursive: true })
    chmodSync(join(home, '.dsh'), 0o500)
    expect(writeSettings({ language: 'zh' }, home)).toBe(false)
  })
})
