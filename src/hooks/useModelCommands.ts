/**
 * Track the current provider's model catalogue for the `/model ` picker.
 *
 * Sibling of `useSkillCommands`, with the same two properties that make a
 * hook rather than a read: the listing is **asynchronous** (`llm.listModels`
 * is a provider round-trip), and the catalogue can change under it
 * (`llm/adapters-updated` fires when a provider route registers, is replaced
 * or is disposed). A failed listing keeps the previous rows rather than
 * emptying the picker mid-session, the same bargain an incomplete skill
 * catalog gets.
 *
 * The scope is deliberately the **current selection's provider**: one
 * round-trip, and the answer to "which models can I switch to" for the
 * provider the session is already talking to. Crossing providers stays a
 * typed `/model <provider>/<id>` line, which the dispatch has always taken.
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
 * Subscribe to the current provider's model catalogue and return it as
 * `/model ` picker rows, with the model the session is on marked.
 *
 * The raw catalogue is the state; the ✓ marking is a memo over it, because a
 * switch changes `selection.model` without changing the catalogue and must
 * not re-run the fetch.
 * @param ctx - the context to read `ctx.llm` from.
 * @param selection - the live model selection; its provider scopes the fetch.
 * @returns model rows for the picker; empty with no selection, no `llm`
 *   service, or a listing that has not answered yet.
 */
export function useModelCommands(
  ctx: Context,
  selection: ModelSelection | undefined,
): readonly CommandMeta[] {
  const [catalogue, setCatalogue] = useState<readonly LlmModelInfo[]>([])
  const provider = selection?.provider

  useEffect(() => {
    if (provider === undefined) return
    const llm = service(ctx, 'llm')
    if (llm === undefined) return
    const controller = new AbortController()
    const refresh = (): void => {
      void llm.listModels(provider)
        .then((models) => {
          if (controller.signal.aborted) return
          // A failed refresh is not news about the catalogue; keeping the
          // previous rows is what stops a flaky endpoint from emptying the
          // picker between two opens.
          setCatalogue(prev => sameCatalogue(prev, models) ? prev : models)
        })
        .catch(() => {})
    }
    refresh()
    const off = ctx.on('llm/adapters-updated', refresh)
    return () => {
      controller.abort()
      off()
    }
  }, [ctx, provider])

  return useMemo(
    () => modelRows(catalogue, selection?.model),
    [catalogue, selection?.model],
  )
}
