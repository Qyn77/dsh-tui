import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'
import { dshHome } from '../mcp/mcp-patch.ts'

export interface Diagnostic {
  text: string
  level: 'warn' | 'error'
  path: string
  truncated: boolean
}
export interface DiagnosticRef { current?: ((entry: Diagnostic) => void) | undefined }
const LEVELS = ['log', 'info', 'debug', 'warn', 'error'] as const

/** Do not retain recognizable API-key material in routine diagnostics. */
export function diagnosticText(args: readonly unknown[]): string {
  return format(...args).replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-…')
}

/** Install after Ink. Ink still owns its original console restoration. */
export function installDiagnostics(ref: DiagnosticRef, write?: (text: string) => void): () => void {
  const path = join(dshHome(), 'tui.log')
  const append = write ?? ((text: string) => {
    mkdirSync(dshHome(), { recursive: true })
    appendFileSync(path, text, { mode: 0o600 })
  })
  const originals = Object.fromEntries(LEVELS.map(level => [level, console[level]])) as Record<typeof LEVELS[number], typeof console.log>
  const wrappers = {} as typeof originals
  for (const level of LEVELS) {
    const wrapped = (...args: unknown[]): void => {
      const text = diagnosticText(args)
      try { append(`${new Date().toISOString()} ${level} ${text}\n`) }
      catch { originals[level](...args); return }
      const routine = /\[llm-deepseek-api-key\].*model listing.*loaded \d+ model/.test(text)
      if ((level === 'warn' || level === 'error') && !routine) {
        queueMicrotask(() => {
          const receive = ref.current
          if (receive) receive({ text: text.slice(0, 1200), level, path, truncated: text.length > 1200 })
          else originals[level](text)
        })
      }
    }
    wrappers[level] = wrapped
    console[level] = wrapped
  }
  return () => {
    for (const level of LEVELS) if (console[level] === wrappers[level]) console[level] = originals[level]
  }
}
