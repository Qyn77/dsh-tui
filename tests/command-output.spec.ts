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

describe('the plan-mode line', () => {
  // `plan/mode` is emitted by `@deepseek-ai/dsh-plan-mode`, which this package
  // does not depend on. Nothing in the TUI can provoke one, so these write the
  // event into the log directly — the same path the plugin would take.
  it('draws a line when the agent enters plan mode', async () => {
    painted = await paintApp({ rows: 40 })
    await painted.append('plan/mode', { enabled: true })
    expect(painted.screen()).toContain('plan mode on')
  })

  it('draws leaving it too, rather than erasing the line', async () => {
    // Both edges stay in the transcript: without the second line, everything
    // after the switch would read as though it were still read-only.
    painted = await paintApp({ rows: 40 })
    await painted.append('plan/mode', { enabled: true })
    await painted.append('plan/mode', { enabled: false })
    const screen = painted.screen()
    expect(screen).toContain('plan mode on')
    expect(screen).toContain('plan mode off')
  })

  it('writes the line in the interface language', async () => {
    painted = await paintApp({ rows: 40, lang: 'zh' })
    await painted.append('plan/mode', { enabled: true })
    expect(painted.screen()).toContain('计划模式已开启')
  })
})

describe('the task list', () => {
  // `todo/write` is emitted by `@deepseek-ai/dsh-tool-todo`, which the TUI does
  // not call directly — these write the event the way the tool would.
  it('draws every task with its own state, and the progress in the header', async () => {
    painted = await paintApp({ rows: 40 })
    await painted.append('todo/write', {
      todos: [
        { content: 'read the spec', status: 'completed' },
        { content: 'write the reducer', status: 'in_progress' },
        { content: 'update the docs', status: 'pending' },
      ],
    })
    const screen = painted.screen()
    expect(screen).toContain('todos · 1/3 done')
    expect(screen).toContain('read the spec')
    expect(screen).toContain('write the reducer')
    expect(screen).toContain('update the docs')
  })

  it('replaces the list in place instead of drawing it twice', async () => {
    // The point of collapsing consecutive writes: checking a box costs no extra
    // rows. Asserting on the header count rather than on task text, because the
    // task text is identical between the two writes by construction.
    painted = await paintApp({ rows: 40 })
    const todos = (status: 'pending' | 'completed') => ({
      todos: [{ content: 'the only task', status }],
    })
    await painted.append('todo/write', todos('pending'))
    await painted.append('todo/write', todos('completed'))
    const screen = painted.screen()
    expect(screen).toContain('todos · 1/1 done')
    expect(screen).not.toContain('0/1')
    expect(screen.split('the only task')).toHaveLength(2)
  })

  it('writes the header in the interface language', async () => {
    painted = await paintApp({ rows: 40, lang: 'zh' })
    await painted.append('todo/write', {
      todos: [{ content: 'a task', status: 'pending' }],
    })
    expect(painted.screen()).toContain('任务清单 · 0/1 已完成')
  })
})
