/**
 * Track the user-invocable skill catalog for the `/` palette.
 *
 * Sibling of `useRegistryCommands`, with two differences that are the whole
 * reason it is a separate hook. Discovery is **asynchronous** — a provider may
 * read directories or talk to a remote registry — so rows arrive after the
 * frame that asked for them. And discovery can come back **incomplete**, which
 * the registry reports rather than hiding: a provider that has not finished
 * starting up yields a partial catalog, and replacing good rows with a partial
 * set would make the palette flicker items out of existence.
 *
 * So an incomplete listing is dropped, not applied. The palette keeps what it
 * last knew until a complete one arrives, and `skills/change` brings it back
 * for another look.
 * @module @deepseek-ai/dsh-tui/hooks/useSkillCommands
 */

import { useEffect, useState } from 'react'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { listSkills, viewingScope } from '../skill-runner.ts'
import { skillRows, withoutShadowed } from '../skills.ts'
import { service } from '../services.ts'
import type { CommandMeta } from '../commands.ts'

/** Whether two row lists describe the same surface. Same reasoning as `useRegistryCommands`. */
function sameRows(a: readonly CommandMeta[], b: readonly CommandMeta[]): boolean {
  if (a.length !== b.length) return false
  return a.every((row, i) => row.name === b[i]?.name && row.description === b[i]?.description)
}

/**
 * Subscribe to the skill registry and return its user-invocable skills as
 * palette rows, minus any whose name a plugin command already holds.
 *
 * Built-ins are not passed in: `filterCommands` already gives them the win
 * over everything in `extraCommands`, so shadowing them here would be a second
 * copy of a rule that is already enforced downstream.
 * @param ctx - the context to read `ctx.skills` from.
 * @param agent - the invoking agent; its scope selects which layers are in view.
 * @param taken - plugin command rows, which outrank skills on a name collision.
 * @returns skill rows for the palette; empty when no registry is mounted.
 */
export function useSkillCommands(
  ctx: Context,
  agent: Agent,
  taken: readonly CommandMeta[],
): readonly CommandMeta[] {
  const [rows, setRows] = useState<readonly CommandMeta[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = (): void => {
      void (async () => {
        const listing = await listSkills({
          skills: service(ctx, 'skills'),
          // `cd` is process-global in this app, so the live value is the only
          // correct one — a captured cwd would keep showing another
          // directory's project skills.
          cwd: process.cwd(),
          scope: viewingScope(agent),
        })
        if (controller.signal.aborted) return
        // A partial catalog is not news. Keeping the previous rows is what
        // stops a slow provider from emptying the palette mid-startup.
        if (!listing.complete) return
        const next = withoutShadowed(skillRows(listing.skills), taken)
        setRows(prev => sameRows(prev, next) ? prev : next)
      })()
    }
    refresh()
    const off = ctx.on('skills/change', refresh)
    return () => {
      controller.abort()
      off()
    }
  }, [ctx, agent, taken])

  return rows
}
