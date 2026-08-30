/**
 * The permission card, at the frame level. Two things here are not visible from
 * the hook's tests: that the question actually reaches the screen with the tool
 * named on it, and that a keystroke maps to the outcome the approval service
 * defines. The second is the part worth a real terminal — a handler compared
 * against a string Ink never delivers passes any unit test and fails in use.
 * @module @deepseek-ai/dsh-tui/tests/approval-frame.spec
 */

import { describe, expect, it } from 'vitest'
import React from 'react'
import { render } from 'ink'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { ApprovalPrompt } from '../src/components/ApprovalPrompt.tsx'
import type { PendingApproval } from '../src/hooks/useApprovalRequests.ts'
import { ESC, fakeStdout, fakeTtyStdin, strip } from './fake-tty.ts'

const { act } = React

interface Painted {
  frame: () => string
  press: (keys: string) => Promise<void>
  answers: [number, ApprovalOutcome][]
  unmount: () => void
}

async function paint(pending: readonly PendingApproval[]): Promise<Painted> {
  const stdout = fakeStdout(60, 10)
  const stdin = fakeTtyStdin()
  const answers: [number, ApprovalOutcome][] = []
  const instance = render(
    React.createElement(ApprovalPrompt, {
      pending,
      onAnswer: (id, outcome) => { answers.push([id, outcome]) },
    }),
    { stdout: stdout as never, stdin, patchConsole: false, debug: true },
  )
  await act(async () => { await Promise.resolve() })
  return {
    // The last frame with anything in it, not simply the last one: on a TTY Ink
    // also writes bare cursor-control chunks, and one of those arriving last
    // would read as an empty screen.
    frame: () => {
      const painted = stdout.frames.map(strip).filter(f => f.trim() !== '')
      return painted.at(-1) ?? ''
    },
    press: async (keys) => {
      await act(async () => {
        stdin.send(keys)
        await Promise.resolve()
      })
    },
    answers,
    unmount: () => { instance.unmount() },
  }
}

const one: PendingApproval[] = [{ id: 1, toolName: 'shell', reason: 'rm -rf ./build' }]

describe('ApprovalPrompt', () => {
  it('names the tool, its reason, and the keys that answer', async () => {
    const view = await paint(one)
    const frame = view.frame()
    expect(frame).toContain('Permission required')
    expect(frame).toContain('shell')
    expect(frame).toContain('rm -rf ./build')
    expect(frame).toContain('y allow once')
    view.unmount()
  })

  it('draws nothing when no question is pending', async () => {
    // The card sits above a prompt that is always on screen, so an empty one
    // would cost two border rows for every idle moment of the session.
    const view = await paint([])
    expect(view.frame().trim()).toBe('')
    view.unmount()
  })

  it('shows only the oldest question, and says how many follow', async () => {
    const view = await paint([
      { id: 1, toolName: 'shell' },
      { id: 2, toolName: 'write' },
      { id: 3, toolName: 'read' },
    ])
    const frame = view.frame()
    expect(frame).toContain('shell')
    expect(frame).not.toContain('write')
    expect(frame).toContain('+2 more waiting')
    view.unmount()
  })

  it('grants once on y', async () => {
    // `'allowed-once'` is the only grant the service defines; there is no
    // "always", so the card must not imply one.
    const view = await paint(one)
    await view.press('y')
    expect(view.answers).toEqual([[1, 'allowed-once']])
    view.unmount()
  })

  it('grants on Y as well as y', async () => {
    const view = await paint(one)
    await view.press('Y')
    expect(view.answers).toEqual([[1, 'allowed-once']])
    view.unmount()
  })

  it('rejects on n', async () => {
    const view = await paint(one)
    await view.press('n')
    expect(view.answers).toEqual([[1, 'rejected']])
    view.unmount()
  })

  it('rejects on Esc', async () => {
    // Esc dismisses everywhere else in this UI; dismissing a permission
    // question can only mean denying it, since leaving it open blocks the turn.
    const view = await paint(one)
    await view.press(ESC)
    expect(view.answers).toEqual([[1, 'rejected']])
    view.unmount()
  })

  it('ignores a key that answers nothing', async () => {
    // Silence beats a guess: a stray keystroke must not decide a permission.
    const view = await paint(one)
    await view.press('x')
    await view.press('\r')
    expect(view.answers).toEqual([])
    view.unmount()
  })
})
