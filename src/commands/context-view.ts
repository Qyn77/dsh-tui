import type { Context } from '@deepseek-ai/cordis'
import { isAgentLoopRequest, type GenerateOptions, type RequestMessage, type ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Catalog } from '../core/i18n.ts'
import { displayWidth } from '../core/width.ts'
function truncateToWidth(text: string, max: number): string {
  if (displayWidth(text) <= max) return text
  let result = ''
  for (const char of text) { if (displayWidth(result + char) > max - 1) break; result += char }
  return result + '…'
}

export interface ContextSnapshot {
  sessionId: string
  seq?: number
  provider?: string
  model?: string
  messages: readonly RequestMessage[]
  tools: readonly ToolSchema[]
}
export type ContextRequestReader = (sessionId: string) => ContextSnapshot | undefined
/** Observe immutable loop requests only; auxiliary calls and other sessions cannot replace the snapshot. */
export function watchContextRequests(ctx: Context, current: () => { id: string; seq: number }) {
  let last: ContextSnapshot | undefined
  const dispose = ctx.on('llm/stream', (options: GenerateOptions, next) => {
    const session = current()
    if (options.sessionId === session.id && options.purpose === undefined && isAgentLoopRequest(options)) {
      last = { sessionId: session.id, seq: session.seq, provider: options.provider, model: options.model,
        messages: options.messages, tools: options.tools ?? [] }
    }
    return next()
  })
  return { read: (sessionId: string) => last?.sessionId === sessionId ? last : undefined, dispose }
}
function metadata(message: RequestMessage): Record<string, unknown> {
  if (!('source' in message)) return {}
  const source = message.source as unknown as Record<string, unknown>
  const result: Record<string, unknown> = {}
  // Sources are extensible. Display declared provenance, never provider-private replay state.
  for (const key of ['kind', 'form', 'path', 'paths', 'name', 'skillName', 'summary', 'callId', 'agentId', 'sessionId', 'sourceSessionId']) {
    if (source[key] !== undefined) result[key] = source[key]
  }
  if (Array.isArray(source.sections)) result['sections'] = source.sections.map((section: { name?: string }) => section.name)
  return result
}
export function contextMessageText(message: RequestMessage): string {
  const header = JSON.stringify({ ...('id' in message ? { id: message.id } : {}), role: message.role,
    source: metadata(message), ...('toolCallId' in message ? { toolCallId: message.toolCallId } : {}) }, null, 2)
  return [header, ...message.content.map((block) => {
    if (block.type === 'text' || block.type === 'reasoning') return `[${block.type}]\n${block.text}`
    if (block.type === 'image' || block.type === 'file') return JSON.stringify({ type: block.type, attachment: block.attachment,
      ...('offloaded' in block ? { offloaded: block.offloaded } : {}) }, null, 2)
    if (block.type === 'tool-call') return `[tool-call ${block.name} · ${block.id}]\n${block.arguments}`
    if (block.type === 'tool-addition' || block.type === 'tool-removal') return `[${block.type}] ${block.toolName}`
    return `[${(block as { type: string }).type}]`
  })].join('\n\n')
}
export function contextRows(snapshot: ContextSnapshot, labels: Catalog['contextView'], width: number): string[] {
  return snapshot.messages.map((message, index) => {
    const source = metadata(message)
    const kinds = message.content.map(block => block.type).join(', ')
    const preview = message.content.find(block => block.type === 'text')
    const text = preview?.type === 'text' ? preview.text.replace(/\s+/g, ' ').trim() : ''
    const kind = typeof source['kind'] === 'string' ? source['kind'] : labels.unknownSource
    const form = typeof source['form'] === 'string' ? `/${source['form']}` : ''
    return truncateToWidth(`${index + 1}. ${message.role} · ${kind}${form} · ${kinds} · ${text}`, Math.max(12, width))
  })
}
