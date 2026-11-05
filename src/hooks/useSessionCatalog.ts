import type { SessionLibrary } from '../terminal/session-library.ts'
import type { Lang } from '../core/i18n.ts'
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandMeta } from '../commands/commands.ts'
import { sessionCatalog } from '../commands/session-catalog.ts'

export function useSessionCatalog(ctx: Context, agent: Agent, enabled: boolean,
  options: { library?: SessionLibrary; revision?: number; lang?: Lang; management?: boolean } = {}): readonly CommandMeta[] {
  const { library, revision, lang, management } = options
  const [result, setResult] = useState<{ agent: Agent; rows: readonly CommandMeta[] }>()
  useEffect(() => {
    if (!enabled) return
    let active = true
    void sessionCatalog(ctx, agent, { library, lang, management }).then(
      (rows) => { if (active) setResult({ agent, rows }) },
      () => { if (active) setResult({ agent, rows: [] }) },
    )
    return () => { active = false }
  }, [ctx, agent, enabled, library, revision, lang, management])
  return result?.agent === agent ? result.rows : []
}
