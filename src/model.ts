/**
 * Pure helpers for the `/model` command: parsing what the user typed,
 * matching it against the provider catalog, and formatting both the
 * current selection and the catalog listing.
 *
 * The one rule that shapes everything here comes from the `dsh-llm`
 * contract, which states it twice and emphatically: **catalog
 * membership is advisory**. An adapter may accept model ids it does
 * not advertise, and "consumers must not turn absence into request
 * rejection". So an unlisted model is a *warning*, never an error.
 *
 * Providers are the opposite. `llm.listProviders()` returns only routes
 * with a registered adapter, so a provider that is not in that list has
 * nothing to stream the request — that genuinely is an error.
 * @module @deepseek-ai/dsh-tui/model
 */

import type { ModelSelection } from '@deepseek-ai/dsh-agent'

/** One `provider`/`model` pair advertised by the catalog. */
export interface ModelRoute {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Human-readable name when the adapter supplies one. */
  name?: string
}

/** What the user typed, split into its optional provider and its model. */
export interface RouteArg {
  /** Provider prefix, when the argument carried one. */
  provider?: string
  /** Model id — everything after the first `/`, or the whole argument. */
  model: string
}

/** Outcome of matching a {@link RouteArg} against the catalog. */
export type RouteResolution =
  /**
   * A route to switch to. `listed` is false when the model is not in the
   * advisory catalog — the caller should warn and proceed, not refuse.
   */
  | { kind: 'ok'; provider: string; model: string; listed: boolean }
  /** A bare model id advertised by more than one provider. */
  | { kind: 'ambiguous'; model: string; providers: readonly string[] }
  /** Nothing usable: an empty argument or an unregistered provider. */
  | { kind: 'invalid'; reason: string }

/**
 * Split a `/model` argument into its provider and model halves.
 *
 * The split is on the *first* `/` because provider routes never contain
 * one while model ids sometimes do (`vendor/model-name` styles), so the
 * first separator is the only unambiguous boundary.
 * @param arg - the text after `/model`, already stripped of the command.
 * @returns the split argument, or `undefined` when nothing was given.
 */
export function parseRouteArg(arg: string): RouteArg | undefined {
  const trimmed = arg.trim()
  if (trimmed === '') return undefined
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) return { model: trimmed }
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) }
}

/**
 * Decide which route a `/model` argument names.
 *
 * A bare model id is looked up in the catalog: exactly one provider
 * advertising it is the happy path, several is ambiguous, and none falls
 * back to the provider already in use — which is the useful reading of
 * `/model some-preview-id` for an adapter whose catalog is incomplete.
 * @param arg - the parsed argument, or `undefined` for no argument.
 * @param catalog - every advertised route, in adapter-preferred order.
 * @param providers - registered provider routes; authoritative.
 * @param currentProvider - provider to assume for an unlisted bare model.
 */
export function resolveRoute(
  arg: RouteArg | undefined,
  catalog: readonly ModelRoute[],
  providers: readonly string[],
  currentProvider: string,
): RouteResolution {
  if (arg === undefined) return { kind: 'invalid', reason: 'no model given' }

  if (arg.provider !== undefined) {
    if (providers.includes(arg.provider)) {
      const listed = catalog.some((r) => r.provider === arg.provider && r.model === arg.model)
      return { kind: 'ok', provider: arg.provider, model: arg.model, listed }
    }
    // The prefix is not a provider. Before rejecting, consider that the
    // whole argument may be a model id that simply contains a slash —
    // `vendor/name` reads exactly like `provider/model`.
    const whole = `${arg.provider}/${arg.model}`
    const owners = [...new Set(catalog.filter((r) => r.model === whole).map((r) => r.provider))]
    if (owners.length === 1) {
      return { kind: 'ok', provider: owners[0] as string, model: whole, listed: true }
    }
    if (owners.length > 1) return { kind: 'ambiguous', model: whole, providers: owners }
    return {
      kind: 'invalid',
      reason:
        providers.length === 0
          ? `unknown provider: ${arg.provider}`
          : `unknown provider: ${arg.provider} (registered: ${providers.join(', ')})`,
    }
  }

  const owners = [...new Set(catalog.filter((r) => r.model === arg.model).map((r) => r.provider))]
  if (owners.length === 1) {
    return { kind: 'ok', provider: owners[0] as string, model: arg.model, listed: true }
  }
  if (owners.length > 1) return { kind: 'ambiguous', model: arg.model, providers: owners }
  return { kind: 'ok', provider: currentProvider, model: arg.model, listed: false }
}

/**
 * Render a selection as one line: `provider/model`, plus the reasoning
 * effort when one is selected. An absent effort is not printed as
 * "default" because absence means "let the provider decide", which is
 * not a value the user picked and not one we can name.
 */
export function formatSelection(selection: ModelSelection): string {
  const base = `${selection.provider}/${selection.model}`
  return selection.reasoningEffort === undefined
    ? base
    : `${base} · ${String(selection.reasoningEffort)}`
}

/** Marker on the row matching the live selection. */
export const CURRENT_MARK = '●'

/**
 * Render the catalog grouped by provider, marking the current route.
 *
 * A provider with nothing to advertise still gets its heading and an
 * explicit note, because "this provider exists but its catalog is
 * empty" and "this provider does not exist" are different facts and the
 * user needs to tell them apart — the first one still accepts an exact
 * model id.
 * @param catalog - every advertised route.
 * @param providers - registered provider routes, in registration order.
 * @param current - the live selection, marked in the listing.
 */
export function formatRoutes(
  catalog: readonly ModelRoute[],
  providers: readonly string[],
  current: ModelSelection,
): string {
  const idColumn = Math.max(0, ...catalog.map((r) => r.model.length))
  const lines: string[] = []
  for (const provider of providers) {
    lines.push(`  ${provider}`)
    const owned = catalog.filter((r) => r.provider === provider)
    if (owned.length === 0) {
      lines.push('      (no advertised catalog — pass an exact model id)')
      continue
    }
    for (const route of owned) {
      const isCurrent = route.provider === current.provider && route.model === current.model
      const mark = isCurrent ? `${CURRENT_MARK} ` : '  '
      const name = route.name !== undefined && route.name !== route.model ? `  ${route.name}` : ''
      lines.push(`    ${mark}${route.model.padEnd(idColumn)}${name}`.trimEnd())
    }
  }
  if (lines.length === 0) lines.push('  (no providers registered)')
  return lines.join('\n')
}
