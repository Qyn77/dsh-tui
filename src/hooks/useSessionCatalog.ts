import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandMeta } from '../commands/commands.ts'
import { sessionCatalog } from '../commands/session-catalog.ts'

export function useSessionCatalog(ctx: Context, agent: Agent, enabled: boolean): readonly CommandMeta[] {
  const [rows, setRows] = useState<readonly CommandMeta[]>([])
  useEffect(() => {
    if (!enabled) return
    let active = true
    void sessionCatalog(ctx, agent).then(next => { if (active) setRows(next) }, () => { if (active) setRows([]) })
    return () => { active = false }
  }, [ctx, agent, enabled])
  return rows
}
