import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** Resolve stable identities, never list positions which can race a claim. */
export function queueMessage(messages: readonly UserMessage[], id: string): UserMessage | undefined {
  const exact = messages.find(message => message.id === id)
  if (exact) return exact
  if (id.length < 8) return undefined
  const matches = messages.filter(message => message.id.startsWith(id))
  return matches.length === 1 ? matches[0] : undefined
}

/** Editing affects text only; image references and source attribution survive. */
export function replaceQueueText(message: UserMessage, text: string): UserMessage {
  return { ...message, content: [{ type: 'text', text }, ...message.content.filter(block => block.type !== 'text')] }
}
