/**
 * Track the plugin command registry's contents for the `/` palette.
 *
 * The registry is mutable at runtime: `CommandRuntime.register` returns a
 * disposer, definitions can be scoped to one agent, and the runtime announces
 * every change as `commands/change`. A palette that read the registry once at
 * mount would keep offering a command whose plugin has since been disposed, and
 * would never learn about one registered after startup.
 *
 * The event is deliberately unfiltered by the runtime — a global or scoped
 * change may affect any view — so this re-reads the whole list rather than
 * trying to apply a delta.
 * @module @deepseek-ai/dsh-tui/hooks/useRegistryCommands
 */

import { useEffect, useState } from 'react'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { registryCommands, type CommandMeta } from '../commands.ts'

/**
 * Whether two command lists describe the same surface. `registryCommands`
 * builds a fresh array on every call, so identity says nothing — without this
 * the hook would write new state on every effect run and re-render for a
 * registry that had not changed. It also makes the hook safe for a caller whose
 * `agent` identity is unstable: the effect re-runs, finds the same list, and
 * stops there instead of looping.
 * @param a - one list.
 * @param b - the other list.
 * @returns whether both hold the same names and descriptions, in order.
 */
function sameCommands(a: readonly CommandMeta[], b: readonly CommandMeta[]): boolean {
  if (a.length !== b.length) return false
  return a.every((row, i) => row.name === b[i]?.name && row.description === b[i]?.description)
}

/**
 * Subscribe to the plugin command registry and return its current commands.
 * @param ctx - the context to read the registry from.
 * @param agent - the receiving agent, whose scoped definitions shadow globals.
 * @returns registry rows for the palette; empty when no registry is mounted.
 */
export function useRegistryCommands(ctx: Context, agent: Agent): readonly CommandMeta[] {
  const [commands, setCommands] = useState<readonly CommandMeta[]>(
    () => registryCommands(ctx, agent),
  )

  useEffect(() => {
    const refresh = (): void => {
      const next = registryCommands(ctx, agent)
      setCommands(prev => sameCommands(prev, next) ? prev : next)
    }
    // Re-read on subscribe as well: a registration between the initial state
    // and this effect would otherwise be missed for the life of the mount.
    refresh()
    const off = ctx.on('commands/change', refresh)
    return () => { off() }
  }, [ctx, agent])

  return commands
}
