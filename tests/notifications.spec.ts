import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { catalog } from '../src/core/i18n.ts'
import { notificationSequence, watchNotifications } from '../src/terminal/notifications.ts'
import { recordedSession } from './recorded-session.ts'

it('uses terminal notification support and strips control characters', () => {
  expect(notificationSequence('off', 'done')).toBe('')
  expect(notificationSequence('bell', 'done')).toBe('\u0007')
  expect(notificationSequence('desktop', 'ok\u001b]bad\u0007\nnext', { TERM_PROGRAM: 'iTerm.app' })).toBe('\u001b]9;ok]bad next\u0007')
  expect(notificationSequence('desktop', 'done', { TERM_PROGRAM: 'Apple_Terminal' })).toBe('\u0007')
})
it('notifies only live events for the active session and detaches on cleanup', () => {
  const ctx = new Context()
  const session = recordedSession('notify')
  const agent = { session } as Agent
  const send = vi.fn()
  const stop = watchNotifications(ctx, agent, send, catalog('en'))
  const event = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } as never
  ctx.emit('session/event', recordedSession('other'), event)
  expect(send).not.toHaveBeenCalled()
  ctx.emit('session/event', session, event)
  expect(send).toHaveBeenCalledWith(catalog('en').notify.completed)
  ctx.emit('session/event', session, { type: 'approval/asked', data: {} } as never)
  expect(send).toHaveBeenCalledWith(catalog('en').notify.approval)
  stop()
  ctx.emit('session/event', session, event)
  expect(send).toHaveBeenCalledTimes(2)
})

it('validates notification preferences independently of older settings', async () => {
  const { parseSettings } = await import('../src/terminal/settings.ts')
  expect(parseSettings('{"notifications":"desktop"}').notifications).toBe('desktop')
  expect(parseSettings('{"notifications":"unknown"}').notifications).toBeUndefined()
})
