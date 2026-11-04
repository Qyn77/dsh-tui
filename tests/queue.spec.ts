import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { queueMessage, replaceQueueText } from '../src/commands/queue.ts'

it('resolves a pending message by exact id or unambiguous long prefix', () => {
  const first = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] })
  const second = { ...first, id: `${first.id}other` as typeof first.id }
  expect(queueMessage([first], first.id)).toBe(first)
  expect(queueMessage([first], first.id.slice(0, 8))).toBe(first)
  expect(queueMessage([first, second], first.id.slice(0, 8))).toBeUndefined()
  expect(queueMessage([first], 'bad')).toBeUndefined()
})
it('replaces pending text without changing identity or removing nontext blocks', () => {
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }] })
  const other = { type: 'image', attachment: { id: 'attached' } } as never
  const replaced = replaceQueueText({ ...message, content: [...message.content, other] }, 'new')
  expect(replaced.id).toBe(message.id)
  expect(replaced.content).toEqual([{ type: 'text', text: 'new' }, other])
  expect(message.content[0]).toMatchObject({ text: 'old' })
})

it('queues a request during a running turn while ordinary Enter still steers', async () => {
  const { paintApp } = await import('./fake-tty.ts')
  const { vi } = await import('vitest')
  const followup = vi.fn<(message: unknown) => void>()
  const steer = vi.fn<(message: unknown) => void>()
  const inbox = { nextTurn: [], nextStep: [] } as never
  const tty = await paintApp({ followup, steer, inbox })
  try {
    await tty.append('turn/start', { turn: 1 })
    await tty.send('/queue add do this later'); await tty.send('\r')
    expect(followup).toHaveBeenCalledOnce()
    expect(followup.mock.calls[0]?.[0]).toMatchObject({ content: [{ type: 'text', text: 'do this later' }] })
    expect(steer).not.toHaveBeenCalled()
    await tty.send('change direction now'); await tty.send('\r')
    expect(steer).toHaveBeenCalledOnce()
    expect(steer.mock.calls[0]?.[0]).toMatchObject({ content: [{ type: 'text', text: 'change direction now' }] })
  } finally { tty.unmount() }
})
