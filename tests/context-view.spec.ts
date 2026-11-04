import { expect, it, vi } from 'vitest'
import { createUserMessage, markAgentLoopRequest, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { contextMessageText, contextRows, watchContextRequests } from '../src/commands/context-view.ts'
import { catalog } from '../src/core/i18n.ts'
import { displayWidth } from '../src/core/width.ts'
import { paintApp } from './fake-tty.ts'

it('observes only the active session loop and always passes through the original stream', () => {
  let listener!: (request: GenerateOptions, next: () => AsyncIterable<never>) => AsyncIterable<unknown>
  const dispose = vi.fn()
  const ctx = { on: vi.fn((_event: string, fn: typeof listener) => { listener = fn; return dispose }) }
  let id = 'one'
  const watcher = watchContextRequests(ctx as never, () => ({ id, seq: 7 }))
  const message = createUserMessage({ content: [{ type: 'text', text: 'actual' }], source: { kind: 'user' } })
  const request = { provider: 'p', model: 'm', sessionId: 'one' as never, messages: [message] }
  const stream = (async function* () {})()
  const next = vi.fn(() => stream)
  expect(listener(request, next)).toBe(stream)
  expect(watcher.read('one')).toBeUndefined()
  expect(listener(markAgentLoopRequest(request), next)).toBe(stream)
  expect(watcher.read('one')?.messages).toBe(request.messages)
  listener(markAgentLoopRequest({ ...request, sessionId: 'other' as never, model: 'other' }), next)
  expect(watcher.read('one')?.model).toBe('m')
  expect(watcher.read('other')).toBeUndefined()
  id = 'two'
  listener(markAgentLoopRequest({ ...request, sessionId: 'two' as never }), next)
  expect(watcher.read('one')).toBeUndefined()
  watcher.dispose(); expect(dispose).toHaveBeenCalledOnce()
  expect(next).toHaveBeenCalledTimes(4)
})
it('shows real provenance and attachments without provider-private replay state or image bytes', () => {
  const message = { role: 'assistant', id: 'm1', source: { kind: 'model', replayState: { secret: 'hidden-adapter-state' } }, content: [
    { type: 'text', text: '全文\n完整内容' },
    { type: 'image', attachment: { attachmentId: 'sha', name: 'shot.png', mediaType: 'image/png', width: 2, height: 3, bytes: 123 }, offloaded: true },
  ] } as never
  const detail = contextMessageText(message)
  expect(detail).toContain('全文\n完整内容')
  expect(detail).toContain('shot.png')
  expect(detail).toContain('offloaded')
  expect(detail).not.toContain('hidden-adapter-state')
  const rows = contextRows({ sessionId: 's', messages: [message], tools: [] }, catalog('zh').contextView, 24)
  expect(displayWidth(rows[0])).toBeLessThanOrEqual(24)
})
it('opens full recorded context in the scrollable inspector and escapes back to the conversation', async () => {
  const tty = await paintApp({ turns: 2 })
  try {
    await tty.send('/context view'); await tty.send('\r')
    expect(tty.screen()).toContain('Current effective session surface')
    expect(tty.screen()).toContain('question 01')
    await tty.send('/context view 1'); await tty.send('\r')
    expect(tty.screen()).toContain('Context inspection')
    expect(tty.screen()).toContain('"role": "user"')
    expect(tty.screen()).toContain('question 01')
    await tty.send('\u001b')
    expect(tty.screen()).not.toContain('Context inspection')
    expect(tty.screen()).toContain('answer 02')
    await tty.send('/context request'); await tty.send('\r')
    expect(tty.screen()).toContain('No loop request captured')
  } finally { tty.unmount() }
})
it('keeps the captured request distinct from new replies and opens its tool declarations', async () => {
  const message = createUserMessage({ content: [{ type: 'text', text: 'captured request only' }], source: { kind: 'user' } })
  const tty = await paintApp({ turns: 2, contextRequest: id => ({ sessionId: id, provider: 'qa', model: 'fixture', seq: 12, messages: [message], tools: [{ name: 'read_file', description: 'read', parameters: { type: 'object' } }] }) })
  try {
    await tty.send('/context request'); await tty.send('\r')
    expect(tty.screen()).toContain('Last observed assembled loop request')
    expect(tty.screen()).toContain('captured request only')
    await tty.send('/context request tools'); await tty.send('\r')
    expect(tty.screen()).toContain('"name": "read_file"')
    expect(tty.screen()).toContain('"parameters"')
  } finally { tty.unmount() }
})

it('starts a long context detail at the top and can scroll to its final line', async () => {
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: Array.from({ length: 80 }, (_, i) => `CONTEXT-LINE-${i}`).join('\n') }] })
  const tty = await paintApp({ rows: 25, contextRequest: id => ({ sessionId: id, messages: [message], tools: [] }) })
  try {
    await tty.send('/context request 1'); await tty.send('\r')
    expect(tty.screen()).toContain('Context inspection')
    expect(tty.screen()).toContain('Last observed assembled loop request')
    expect(tty.screen()).not.toContain('CONTEXT-LINE-79')
    await tty.send('\u001b[F')
    expect(tty.screen()).toContain('CONTEXT-LINE-79')
    await tty.send('\u001b')
    expect(tty.screen()).not.toContain('Context inspection')
  } finally { tty.unmount() }
})
