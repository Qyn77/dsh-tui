import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Catalog } from '../core/i18n.ts'

export type NotificationMode = 'off' | 'bell' | 'desktop'
export function isNotificationMode(value: unknown): value is NotificationMode {
  return value === 'off' || value === 'bell' || value === 'desktop'
}

/** Generic chrome only. Never include prompt, result, path or credential text. */
export function notificationSequence(mode: NotificationMode, title: string,
  env: { TERM_PROGRAM?: string | undefined } = process.env): string {
  if (mode === 'off') return ''
  if (mode !== 'desktop' || !['iTerm.app', 'WezTerm', 'WarpTerminal'].includes(env.TERM_PROGRAM ?? '')) return '\u0007'
  const safe = title.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 160)
  return `\u001b]9;${safe}\u0007`
}

/** Subscribe to committed live events only: hydration must never replay alerts. */
export function watchNotifications(ctx: Context, agent: Agent, send: (title: string) => void, strings: Catalog): () => void {
  return ctx.on('session/event', (owner, event) => {
    if (owner !== agent.session) return
    if (event.type === 'approval/asked') send(strings.notify.approval)
    if (event.type === 'turn/end') send(event.data.reason.kind === 'completed'
      ? strings.notify.completed : strings.notify.ended(event.data.reason.kind))
  })
}
