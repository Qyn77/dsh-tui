/**
 * Slash command output has to land where the user can read it.
 *
 * These are frame-level rather than unit tests on purpose. `dispatch` already
 * returned the right string before this behaviour was fixed — the defect was
 * entirely in where the App put it: `process.stderr`, inside the alternate
 * screen, on the same rows Ink was driving. Only a rendered frame can tell the
 * two apart, so every assertion here reads the composed screen.
 * @module @deepseek-ai/dsh-tui/tests/command-output
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { paintApp, type Painted } from './fake-tty.ts'

let painted: Painted | undefined

afterEach(() => {
  painted?.unmount()
  painted = undefined
  vi.restoreAllMocks()
})

/** Type a command into the prompt and submit it. */
async function run(app: Painted, command: string): Promise<void> {
  await app.send(command)
  await app.send('\r')
}

describe('slash command output', () => {
  it('renders /help into the conversation', async () => {
    painted = await paintApp({ rows: 40 })
    await run(painted, '/help')
    const screen = painted.screen()
    expect(screen).toContain('/help')
    expect(screen).toContain('Available commands')
    // Sourced from COMMANDS, so the rendered table lists real commands.
    expect(screen).toContain('/status')
  })

  it('renders /status into the conversation', async () => {
    painted = await paintApp({ rows: 40 })
    await run(painted, '/status')
    const screen = painted.screen()
    expect(screen).toContain('deepseek-official/deepseek-v4-flash')
  })

  it('reports an unknown command in the log instead of silently dropping it', async () => {
    painted = await paintApp({ rows: 40 })
    await run(painted, '/nope')
    const screen = painted.screen()
    expect(screen).toContain('/nope')
    expect(screen).toContain('unknown command')
  })

  it('never writes command output to stderr', async () => {
    // The regression this whole change exists to prevent. stderr inside the
    // alternate screen is not a place a user can read.
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    painted = await paintApp({ rows: 40 })
    await run(painted, '/help')
    await run(painted, '/nope')
    expect(stderr).not.toHaveBeenCalled()
  })

  it('leaves the log empty after /clear so the banner returns', async () => {
    painted = await paintApp({ turns: 2, rows: 40 })
    expect(painted.screen()).toContain('question 01')
    await run(painted, '/clear')
    const screen = painted.screen()
    expect(screen).not.toContain('question 01')
    // An empty log is what puts the banner back; a "View cleared." entry
    // would have kept it off screen forever. Assert on the tip line rather
    // than the wordmark — the wordmark is ASCII art, not the literal string.
    expect(screen).toContain('Tip: /help')
  })
})
