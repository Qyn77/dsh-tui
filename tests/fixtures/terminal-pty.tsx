/** Real PTY smoke fixture: production App/Ink/adapter, deterministic agent, no model calls. */
import React from 'react'
import { render } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { writeSync } from 'node:fs'
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
const eventsFd = process.env['DSH_PTY_EVENTS_FD']
const resized = () => {
  if (eventsFd) writeSync(Number(eventsFd), `resize:${process.stdout.columns}x${process.stdout.rows}\n`)
}
process.stdout.on('resize', resized)
terminal.subscribe((event) => {
  seen[event.kind] = (seen[event.kind] ?? 0) + 1
  // Escape is intentionally held by the decoder to distinguish a key from a
  // protocol prefix. A test-only pipe lets the driver await that decision.
  if (eventsFd && event.kind === 'key' && event.key.escape) writeSync(Number(eventsFd), 'escape\n')
})
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
  process.stdout.off('resize', resized)
  terminal.dispose()
  process.stdout.write(`\nTERMINAL_PTY_RESULT=${JSON.stringify({ submissions, imageReads, seen,
    diagnostics: terminal.diagnostics(), raw: process.stdin.isRaw,
    dimensions: { columns: process.stdout.columns, rows: process.stdout.rows } })}\n`)
}
