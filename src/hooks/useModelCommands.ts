/**
 * Track every registered provider's model catalogue for the `/model ` picker.
 *
 * Sibling of `useSkillCommands`, with the same two properties that make a
 * hook rather than a read: the listing is **asynchronous** (`llm.listModels`
 * is a provider round-trip per route), and the topology can change under it
 * (`llm/adapters-updated` fires when a provider route registers, is replaced
 * or is disposed). A failed listing keeps the previous rows rather than
 * emptying the picker mid-session, the same bargain an incomplete skill
 * catalog gets.
 *
 * The scope is **every provider `listProviders()` reports**, not just the
 * current selection's: one adapter can serve several routes, and a second
 * adapter mounting without a restart should be pickable the moment its tools
 * are. The fetches run in parallel and settle independently, so a slow route
 * cannot hold back the rows of a fast one; each route's slice of the
 * catalogue is replaced as a unit, and a route that disappears on
 * `llm/adapters-updated` has its slice dropped on the next refresh.
 * @module @deepseek-ai/dsh-tui/hooks/useModelCommands
 */

import { useEffect, useMemo, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { service } from '../core/services.ts'
import { modelRows } from '../pickers/model-picker.ts'
import type { CommandMeta } from '../commands/commands.ts'

/** Whether two model lists describe the same catalogue. */
function sameCatalogue(a: readonly LlmModelInfo[], b: readonly LlmModelInfo[]): boolean {
  if (a.length !== b.length) return false
  return a.every((model, i) => model.id === b[i]?.id && model.name === b[i]?.name)
}

/**
 * Subscribe to every provider's model catalogue and return it as `/model `
 * picker rows, with the model the session is on marked.
 *
 * The raw catalogue is the state; the ✓ marking is a memo over it, because a
 * switch changes the selection without changing the catalogue and must not
 * re-run the fetches.
 * @param ctx - the context to read `ctx.llm` from.
 * @param selection - the live model selection; its route is the ticked row.
 * @returns model rows for the picker; empty with no selection, no `llm`
 *   service, or a listing that has not answered yet.
 */
export function useModelCommands(
  ctx: Context,
  selection: ModelSelection | undefined,
): readonly CommandMeta[] {
  // Catalogue keyed by provider route, plus the route display names read at
  // the same moment. One state value so a refresh that adds and drops routes
  // lands as one render.
  const [catalogue, setCatalogue] = useState<{
    byProvider: ReadonlyMap<string, readonly LlmModelInfo[]>
    names: ReadonlyMap<string, string>
    order: readonly string[]
  }>({ byProvider: new Map(), names: new Map(), order: [] })

  useEffect(() => {
    const llm = service(ctx, 'llm')
    if (llm === undefined) return
    const controller = new AbortController()
    const refresh = (): void => {
      const providers = llm.listProviders()
      const order = providers.map(p => p.id)
      const names = new Map(providers.map(p => [p.id, p.name]))
      void Promise.all(
        order.map(async (provider) => {
          try {
            return [provider, await llm.listModels(provider)] as const
          } catch {
            return undefined
          }
        }),
      ).then((settled) => {
        if (controller.signal.aborted) return
        const listings = settled.filter((entry): entry is readonly [string, LlmModelInfo[]] => entry !== undefined)
        setCatalogue((prev) => {
          // A route whose listing failed keeps its previous slice: a flaky
          // endpoint must not empty rows the user could still pick.
          const byProvider = new Map<string, readonly LlmModelInfo[]>()
          for (const [provider, models] of listings) {
            const old = prev.byProvider.get(provider)
            byProvider.set(provider, old !== undefined && sameCatalogue(old, models) ? old : models)
          }
          for (const provider of order) {
            const old = prev.byProvider.get(provider)
            if (old !== undefined && !byProvider.has(provider)) byProvider.set(provider, old)
          }
          const same
            = byProvider.size === prev.byProvider.size
            && order.length === prev.order.length
            && order.every((provider, i) => provider === prev.order[i] && byProvider.get(provider) === prev.byProvider.get(provider))
          return same ? prev : { byProvider, names, order }
        })
      })
    }
    refresh()
    const off = ctx.on('llm/adapters-updated', refresh)
    return () => {
      controller.abort()
      off()
    }
  }, [ctx])

  return useMemo(() => {
    const models = catalogue.order.flatMap(provider => catalogue.byProvider.get(provider) ?? [])
    return modelRows(models, selection, provider => catalogue.names.get(provider) ?? provider)
  }, [catalogue, selection])
}
