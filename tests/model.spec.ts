/**
 * The `/model` command's pure core: argument parsing, catalog matching,
 * and formatting. The rule under test throughout is the `dsh-llm`
 * contract that catalog membership is *advisory* — an unlisted model
 * resolves successfully with `listed: false`, while an unregistered
 * provider is a hard error.
 */

import { describe, expect, it } from 'vitest'
import {
  CURRENT_MARK,
  formatRoutes,
  formatSelection,
  parseRouteArg,
  resolveRoute,
  type ModelRoute,
} from '../src/model.ts'

const CATALOG: ModelRoute[] = [
  { provider: 'deepseek', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { provider: 'deepseek', model: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
  { provider: 'mirror', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
]
const PROVIDERS = ['deepseek', 'mirror', 'quiet']

describe('parseRouteArg', () => {
  it('returns undefined for an empty or whitespace argument', () => {
    expect(parseRouteArg('')).toBeUndefined()
    expect(parseRouteArg('   ')).toBeUndefined()
  })

  it('splits a provider prefix off the model', () => {
    expect(parseRouteArg('deepseek/deepseek-v4-flash')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
    })
  })

  it('treats a bare id as a model with no provider', () => {
    expect(parseRouteArg('deepseek-v4-flash')).toEqual({ model: 'deepseek-v4-flash' })
  })

  it('splits on the first slash only, so a model id may contain one', () => {
    // Provider routes never contain a slash but model ids sometimes do,
    // which makes the first separator the only unambiguous boundary.
    expect(parseRouteArg('router/vendor/model-x')).toEqual({
      provider: 'router',
      model: 'vendor/model-x',
    })
  })

  it('keeps a leading or trailing slash as part of the model', () => {
    // Neither half of `/x` or `x/` names a provider, so there is
    // nothing to split — hand the whole thing over as a model id.
    expect(parseRouteArg('/x')).toEqual({ model: '/x' })
    expect(parseRouteArg('x/')).toEqual({ model: 'x/' })
  })

  it('trims surrounding whitespace', () => {
    expect(parseRouteArg('  deepseek/v4  ')).toEqual({ provider: 'deepseek', model: 'v4' })
  })
})

describe('resolveRoute', () => {
  it('reports a missing argument as invalid', () => {
    expect(resolveRoute(undefined, CATALOG, PROVIDERS, 'deepseek')).toEqual({
      kind: 'invalid',
      reason: 'no model given',
    })
  })

  it('accepts an explicit provider/model that the catalog advertises', () => {
    expect(
      resolveRoute({ provider: 'deepseek', model: 'deepseek-reasoner' }, CATALOG, PROVIDERS, 'deepseek'),
    ).toEqual({ kind: 'ok', provider: 'deepseek', model: 'deepseek-reasoner', listed: true })
  })

  it('accepts an unlisted model on a registered provider, flagged unlisted', () => {
    // The dsh-llm contract is explicit that adapters may accept model
    // ids they do not advertise, so absence from the catalog must not
    // become a rejection — only a warning the caller can surface.
    expect(
      resolveRoute({ provider: 'quiet', model: 'some-preview' }, CATALOG, PROVIDERS, 'deepseek'),
    ).toEqual({ kind: 'ok', provider: 'quiet', model: 'some-preview', listed: false })
  })

  it('rejects an unregistered provider and names the ones that exist', () => {
    // Providers are the opposite of models: listProviders() returns
    // only routes with an adapter, so an absent one cannot stream.
    const result = resolveRoute({ provider: 'nope', model: 'x' }, CATALOG, PROVIDERS, 'deepseek')
    expect(result.kind).toBe('invalid')
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('nope')
      expect(result.reason).toContain('deepseek, mirror, quiet')
    }
  })

  it('infers the provider for a bare model only one provider advertises', () => {
    expect(
      resolveRoute({ model: 'deepseek-reasoner' }, CATALOG, PROVIDERS, 'mirror'),
    ).toEqual({ kind: 'ok', provider: 'deepseek', model: 'deepseek-reasoner', listed: true })
  })

  it('reports a bare model advertised by several providers as ambiguous', () => {
    expect(resolveRoute({ model: 'deepseek-v4-flash' }, CATALOG, PROVIDERS, 'deepseek')).toEqual({
      kind: 'ambiguous',
      model: 'deepseek-v4-flash',
      providers: ['deepseek', 'mirror'],
    })
  })

  it('falls back to the current provider for a bare model nobody advertises', () => {
    // The useful reading of `/model some-preview-id` when the adapter's
    // catalog is incomplete: keep the provider already in use.
    expect(resolveRoute({ model: 'some-preview' }, CATALOG, PROVIDERS, 'mirror')).toEqual({
      kind: 'ok',
      provider: 'mirror',
      model: 'some-preview',
      listed: false,
    })
  })

  it('reads a slashed model id as one model when the prefix is not a provider', () => {
    const catalog: ModelRoute[] = [{ provider: 'router', model: 'vendor/model-x' }]
    expect(
      resolveRoute({ provider: 'vendor', model: 'model-x' }, catalog, ['router'], 'router'),
    ).toEqual({ kind: 'ok', provider: 'router', model: 'vendor/model-x', listed: true })
  })

  it('reports an ambiguous slashed model id rather than guessing', () => {
    const catalog: ModelRoute[] = [
      { provider: 'a', model: 'vendor/model-x' },
      { provider: 'b', model: 'vendor/model-x' },
    ]
    expect(
      resolveRoute({ provider: 'vendor', model: 'model-x' }, catalog, ['a', 'b'], 'a'),
    ).toEqual({ kind: 'ambiguous', model: 'vendor/model-x', providers: ['a', 'b'] })
  })

  it('still names the failure when no providers are registered at all', () => {
    const result = resolveRoute({ provider: 'x', model: 'y' }, [], [], 'x')
    expect(result).toEqual({ kind: 'invalid', reason: 'unknown provider: x' })
  })
})

describe('formatSelection', () => {
  it('joins the provider and model with a slash', () => {
    expect(formatSelection({ provider: 'deepseek', model: 'v4' })).toBe('deepseek/v4')
  })

  it('appends the reasoning effort when one is selected', () => {
    expect(
      formatSelection({ provider: 'deepseek', model: 'v4', reasoningEffort: 'high' as never }),
    ).toBe('deepseek/v4 · high')
  })

  it('prints nothing for an absent effort', () => {
    // Absence means "let the provider decide", which is not a value the
    // user picked and not one we can honestly name "default".
    expect(formatSelection({ provider: 'deepseek', model: 'v4' })).not.toContain('·')
  })
})

describe('formatRoutes', () => {
  it('groups models under their provider and marks the current one', () => {
    const out = formatRoutes(CATALOG, PROVIDERS, { provider: 'deepseek', model: 'deepseek-reasoner' })
    const lines = out.split('\n')
    expect(lines[0]).toBe('  deepseek')
    expect(lines.find((l) => l.includes(CURRENT_MARK))).toContain('deepseek-reasoner')
    // Exactly one row is current, even though `deepseek-v4-flash`
    // appears under two providers.
    expect(lines.filter((l) => l.includes(CURRENT_MARK))).toHaveLength(1)
  })

  it('distinguishes an empty catalog from a missing provider', () => {
    // "quiet exists but advertises nothing" still accepts an exact
    // model id; the user has to be able to tell that from "quiet does
    // not exist".
    const out = formatRoutes(CATALOG, PROVIDERS, { provider: 'deepseek', model: 'x' })
    expect(out).toContain('  quiet')
    expect(out).toContain('no advertised catalog')
  })

  it('aligns the model ids into a column', () => {
    const out = formatRoutes(CATALOG, ['deepseek'], { provider: 'x', model: 'y' })
    const [flash, reasoner] = out.split('\n').slice(1)
    expect(flash?.indexOf('DeepSeek')).toBe(reasoner?.indexOf('DeepSeek'))
  })

  it('omits the human name when it merely repeats the id', () => {
    const out = formatRoutes([{ provider: 'p', model: 'm', name: 'm' }], ['p'], {
      provider: 'p',
      model: 'm',
    })
    expect(out.split('\n')[1]).toBe('    ● m')
  })

  it('says so when nothing is registered', () => {
    expect(formatRoutes([], [], { provider: 'p', model: 'm' })).toBe('  (no providers registered)')
  })
})
