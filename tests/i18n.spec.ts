/**
 * The catalog's own invariants.
 *
 * These tests are the reason `src/i18n.ts` is a pure module: they check the
 * *shape* of every language against the source-of-truth English one without
 * mounting a component or reading a file. A missing translation is caught here
 * as a failing test, which is the only thing standing between a new string and
 * an English sentence appearing in the middle of a Chinese screen.
 * @module @deepseek-ai/dsh-tui/tests/i18n
 */

import { describe, expect, it } from 'vitest'
import {
  CATALOGS,
  COMMAND_NAMES,
  LANGUAGES,
  catalog,
  isLang,
  parseLanguageArg,
  type Lang,
} from '../src/i18n.ts'
import { displayWidth } from '../src/width.ts'

/**
 * Every leaf path in an object, dotted. Functions are leaves — a catalog entry
 * is either a string or a formatter, and both are values a translation has to
 * supply.
 */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

/** Every string leaf, dotted path to value, for the emptiness checks. */
function stringLeaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]]
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) =>
    stringLeaves(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

describe('catalog parity', () => {
  const reference = leafPaths(CATALOGS.en).sort()

  for (const lang of LANGUAGES) {
    it(`${lang} defines exactly the keys English does`, () => {
      expect(leafPaths(CATALOGS[lang]).sort()).toEqual(reference)
    })

    it(`${lang} has no empty strings`, () => {
      // An empty string type-checks and renders as nothing at all, which on
      // screen is indistinguishable from a layout bug.
      const empty = stringLeaves(CATALOGS[lang]).filter(([, text]) => text.trim() === '')
      expect(empty).toEqual([])
    })

    it(`${lang} describes every built-in command`, () => {
      // The palette and `/help` read descriptions by name. A name without one
      // would render a command with a blank explanation beside it.
      for (const name of COMMAND_NAMES) {
        expect(catalog(lang).commands[name]).toBeTruthy()
      }
    })
  }
})

describe('catalog column budgets', () => {
  // The status bar pads its three labels to one shared width, and a CJK glyph
  // occupies two terminal columns. A long translation there does not wrap — it
  // pushes the numbers out of alignment across the whole column.
  const LABEL_BUDGET = displayWidth('session: ')

  for (const lang of LANGUAGES) {
    it(`${lang} keeps the status labels inside the label column`, () => {
      const { session, input, output } = catalog(lang).status
      for (const label of [session, input, output]) {
        expect(displayWidth(label)).toBeLessThan(LABEL_BUDGET)
      }
    })
  }
})

describe('parseLanguageArg', () => {
  it('accepts the canonical codes', () => {
    expect(parseLanguageArg('en')).toBe('en')
    expect(parseLanguageArg('zh')).toBe('zh')
  })

  it('ignores case and surrounding space', () => {
    expect(parseLanguageArg('  ZH  ')).toBe('zh')
    expect(parseLanguageArg('English')).toBe('en')
  })

  it('accepts the locale-style and native spellings a user is likely to try', () => {
    expect(parseLanguageArg('zh-CN')).toBe('zh')
    expect(parseLanguageArg('中文')).toBe('zh')
    expect(parseLanguageArg('英文')).toBe('en')
  })

  it('returns undefined for a language it does not have', () => {
    // Reported to the user rather than defaulted, so a typo cannot look like
    // a successful switch.
    expect(parseLanguageArg('fr')).toBeUndefined()
    expect(parseLanguageArg('')).toBeUndefined()
  })
})

describe('isLang', () => {
  it('accepts every supported code and nothing else', () => {
    for (const lang of LANGUAGES) expect(isLang(lang)).toBe(true)
    for (const value of ['fr', '', 'EN', 0, null, undefined, {}] as unknown[]) {
      expect(isLang(value)).toBe(false)
    }
  })
})

describe('catalog', () => {
  it('returns a distinct catalog per language', () => {
    // Guards the copy-paste failure where one language object is aliased to
    // the other and the switch silently does nothing.
    const langs: Lang[] = [...LANGUAGES]
    expect(catalog('en').prompt.placeholder).not.toBe(catalog('zh').prompt.placeholder)
    expect(new Set(langs.map(l => catalog(l))).size).toBe(langs.length)
  })
})
