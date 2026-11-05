/** Real PTY smoke fixture: production App/Ink/adapter, deterministic agent, no model calls. */
import React from 'react'
import { render } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { App } from '../../src/renderer.tsx'
import { createTerminalService } from '../../src/terminal/adapters/service.ts'
import { seedSession, provideHistory } from '../fake-tty.ts'

if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('PTY required')
const ctx = new Context()
const session = seedSession(12, 'terminal-pty')
provideHistory(ctx, () => session)
ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) } as never)
let submissions = 0
let imageReads = 0
const terminal = createTerminalService({ write: text => process.stdout.write(text) })
const seen: Record<string, number> = {}
terminal.subscribe((event) => { seen[event.kind] = (seen[event.kind] ?? 0) + 1 })
terminal.resume()
const agent = { id: session.id, session, status: 'idle', on: () => () => {},
  followup: () => { submissions++ }, whenIdle: () => Promise.resolve() }
const instance = render(<App ctx={ctx} agent={agent as never} terminalService={terminal}
  lang="en" themePref="dark" appearance="dark"
  onMousePreferenceChange={(next) => { terminal.modes.setPreference(next) }}
  pasteImage={async () => { imageReads++; return { kind: 'empty' } }}
  exit={() => { instance.unmount() }} />, { exitOnCtrlC: false, patchConsole: false })
ctx.provide('appExit', () => { instance.unmount() })
const deadline = setTimeout(() => { process.exitCode = 1; instance.unmount() }, 15_000)
try {
  await instance.waitUntilExit()
} finally {
  clearTimeout(deadline)
  terminal.dispose()
  process.stdout.write(`\nTERMINAL_PTY_RESULT=${JSON.stringify({ submissions, imageReads, seen,
    diagnostics: terminal.diagnostics(), raw: process.stdin.isRaw })}\n`)
}
