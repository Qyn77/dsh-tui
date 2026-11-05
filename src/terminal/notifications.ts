import { createTerminalService } from './adapters/service.ts'
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
  return createTerminalService({ env }).notification(mode, title)
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
