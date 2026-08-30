/**
 * Which stored session a run should continue.
 *
 * The mechanics of resuming are not this module's problem: `AgentRegistry`
 * already has `resume({ resumeSessionId })`, which loads the log through
 * `SessionPersistence`, durably closes an interrupted final turn, and publishes
 * the reconstructed session — and `useSessionEvents` already seeds the view from
 * `agent.session.events`, so a resumed transcript draws itself. What was missing
 * is only the decision of *which* id, and what to do when the answer is nothing.
 *
 * That decision is separated out because every one of its failure paths is a
 * user-visible choice rather than an error: a missing persistence plugin, an
 * empty store, and an id that is not there all mean "start fresh, and say why".
 * A resume that silently became a new session would be the worst outcome — the
 * user would type into an empty terminal believing their history was behind it.
 * @module @deepseek-ai/dsh-tui/resume
 */

import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { service } from './services.ts'

/** The literal request that means "the most recently created stored session". */
export const LATEST = 'last'

/**
 * What a run should do about resuming.
 *
 * `fresh` carries an optional `notice`: a request that could not be honoured
 * still starts a session, and the reason has to reach the transcript, because
 * the alternate screen erases anything written to stderr before Ink's first
 * frame.
 */
export type ResumePlan =
  | { kind: 'resume'; id: SessionId }
  | { kind: 'fresh'; notice?: string }

/**
 * Read the resume request from the environment, for runs that are not
 * configured through a patch file. `DSH_TUI_RESUME=last` continues the newest
 * stored session; any other non-empty value is taken as a session id.
 * @returns the requested target, or undefined when the variable is unset or blank.
 */
export function requestFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env['DSH_TUI_RESUME']?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

/** Newest first, by durable creation time. */
function newest(headers: readonly SessionHeader[]): SessionHeader | undefined {
  return [...headers].sort((a, b) => b.createdAt - a.createdAt)[0]
}

/**
 * Decide what one run resumes.
 *
 * The store is listed even for an explicit id, so an id that is not there is
 * reported as such instead of being handed to `resume()` — the registry's own
 * failure for a missing session rejects the boot, and refusing to start a
 * terminal because a typed id was wrong is a worse trade than starting a fresh
 * one with the reason on screen.
 * @param ctx - the plugin context; `sessionPersistence` is read optionally.
 * @param request - `'last'`, a session id, or undefined for no request at all.
 * @param signal - optional cancellation for the backend listing.
 * @returns the plan the runner should follow.
 */
export async function planResume(
  ctx: Context,
  request: string | undefined,
  signal?: AbortSignal,
): Promise<ResumePlan> {
  if (request === undefined) return { kind: 'fresh' }
  const persistence = service(ctx, 'sessionPersistence')
  if (persistence === undefined) {
    return {
      kind: 'fresh',
      notice: 'Cannot resume: no session persistence is mounted, so nothing was stored to resume from.',
    }
  }
  const headers = await persistence.list(signal)
  if (request === LATEST) {
    const latest = newest(headers)
    if (latest === undefined) {
      return { kind: 'fresh', notice: 'Cannot resume: no stored sessions yet. This is the first one.' }
    }
    return { kind: 'resume', id: latest.id }
  }
  const match = headers.find(header => header.id === request)
  if (match === undefined) {
    return { kind: 'fresh', notice: `Cannot resume: no stored session with id "${request}".` }
  }
  return { kind: 'resume', id: SessionId(request) }
}
