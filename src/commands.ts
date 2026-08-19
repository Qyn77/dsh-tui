/**
 * Slash command dispatch for the TUI prompt. Commands are intercepted in the
 * input handler and never reach the model — they own their own UX. The
 * returned status tells the prompt what to do next.
 * @module @deepseek-ai/dsh-tui/commands
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'

/** What a command decided. */
export type CommandResult =
  | { kind: 'handled'; message?: string }
  | { kind: 'exit' }
  | { kind: 'unknown'; input: string }

/** Static help text shown by `/help`. */
const HELP_TEXT = [
  'Available commands:',
  '  /help      Show this message',
  '  /clear     Clear the visible chat (keeps the session log intact)',
  '  /status    Print the current model and session id',
  '  /exit      Leave the REPL (also: /quit)',
  '  /quit      Alias for /exit',
].join('\n')

/** Snapshot one command from the registry. */
export interface CommandContext {
  ctx: Context
  agent: Agent
  /** Reset the visible chat to an empty list. */
  resetView: () => void
}

/**
 * Dispatch a `/...` line to its handler. The trailing whitespace is trimmed;
 * a leading `/` is required. Anything unknown returns `kind: 'unknown'`.
 * @param raw - the raw input line, including the leading `/`.
 * @param cmd - the dispatch context.
 * @returns what the caller should do next.
 */
export function dispatch(raw: string, cmd: CommandContext): CommandResult {
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  switch (name) {
    case '/help':
      return { kind: 'handled', message: HELP_TEXT }

    case '/clear':
      cmd.resetView()
      return { kind: 'handled', message: 'View cleared.' }

    case '/status': {
      const selection = cmd.ctx.get('agentDefaultModel')?.currentSelection()
      const model = selection ? `${selection.provider}/${selection.model}` : 'unknown'
      return {
        kind: 'handled',
        message: `model: ${model}\nsession: ${cmd.agent.id}`,
      }
    }

    case '/exit':
    case '/quit': {
      // Request a process exit through the launcher's bounded host hook.
      const exit = cmd.ctx.get('appExit')
      if (exit !== undefined) exit(0)
      else process.exit(0)
      return { kind: 'exit' }
    }

    default:
      return { kind: 'unknown', input: raw }
  }
}

/** Re-export the SessionId constructor for callers that build new sessions. */
export { SessionId }
