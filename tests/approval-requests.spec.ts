/**
 * `useApprovalRequests` — the half of tool approval that was missing. What is
 * under test is not a rendering but a settlement protocol: the hook answers a
 * waterfall whose promise a tool call is blocked on, so every test here asserts
 * both what the card shows *and* what value the caller finally receives.
 *
 * The dispatch is done by hand rather than through a real `ApprovalService`,
 * because the service only reaches this listener after opening a turn and
 * consulting the agent's policy. Those are its tests, not this hook's; here the
 * relevant surface is exactly the waterfall's `(req, next)` contract, including
 * the terminal `next` that yields `'unavailable'` when nobody claims — which is
 * what the service really passes.
 * @module @deepseek-ai/dsh-tui/tests/approval-requests.spec
 */

import { describe, expect, it } from 'vitest'
import React from 'react'
import { render, Text } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { useApprovalRequests, type ApprovalQueue } from '../src/hooks/useApprovalRequests.ts'
import { fakeStdout } from './fake-tty.ts'

const { act } = React

const AGENT = { id: 'tui-1' } as never

/** A mounted probe over the hook, for one agent. */
interface Probe {
  /** The tool names currently waiting on an answer, oldest first. */
  waiting: () => string[]
  queue: () => ApprovalQueue
  /** Answer a question by its position in the pending list. */
  answer: (index: number, outcome: ApprovalOutcome) => Promise<void>
  unmount: () => Promise<void>
}

async function mount(ctx: Context, agent: unknown = AGENT): Promise<Probe> {
  let latest: ApprovalQueue = { pending: [], answer: () => {} }
  const Harness: React.FC = () => {
    latest = useApprovalRequests(ctx, agent as never)
    return React.createElement(Text, null, 'probe')
  }
  const instance = render(React.createElement(Harness), {
    stdout: fakeStdout(80, 10) as never,
    patchConsole: false,
    debug: true,
  })
  await act(async () => { await Promise.resolve() })
  return {
    waiting: () => latest.pending.map(q => q.toolName),
    queue: () => latest,
    answer: async (index, outcome) => {
      const target = latest.pending[index]
      if (target === undefined) throw new Error(`no pending question at ${index}`)
      await act(async () => {
        latest.answer(target.id, outcome)
        await Promise.resolve()
      })
    },
    unmount: async () => {
      await act(async () => {
        instance.unmount()
        await Promise.resolve()
      })
    },
  }
}

/**
 * Ask the way `ApprovalService` asks: a waterfall whose terminal `next` reports
 * `'unavailable'`. The promise is returned unawaited on purpose — a question the
 * user has not answered yet must not settle. The dispatch is wrapped in a
 * *synchronous* `act` rather than an async one: the listener enqueues its state
 * update before its first await, so a sync scope catches the render, while an
 * async scope would still be open when the next line asks again.
 */
function ask(ctx: Context, req: Partial<ApprovalRequest> & { toolName: string }): Promise<ApprovalOutcome> {
  const full = { agent: AGENT, ...req } as ApprovalRequest
  let answered!: Promise<ApprovalOutcome>
  act(() => {
    answered = ctx.waterfall(
      'approval/request',
      full,
      () => Promise.resolve<ApprovalOutcome>('unavailable'),
    )
  })
  return answered
}

describe('useApprovalRequests', () => {
  it('surfaces a request and settles it with the answer given', async () => {
    const ctx = new Context()
    const probe = await mount(ctx)
    const answered = ask(ctx, { toolName: 'shell', reason: 'rm -rf ./build' })
    await act(async () => { await Promise.resolve() })
    expect(probe.waiting()).toEqual(['shell'])
    expect(probe.queue().pending[0]?.reason).toBe('rm -rf ./build')

    await probe.answer(0, 'allowed-once')
    expect(await answered).toBe('allowed-once')
    expect(probe.waiting()).toEqual([])
    await probe.unmount()
  })

  it('settles a denial as a rejection', async () => {
    // The outcome vocabulary is the service's, not the view's: `'rejected'` is
    // what `dsh-tools` turns into a deny with a reason the model can read.
    const ctx = new Context()
    const probe = await mount(ctx)
    const answered = ask(ctx, { toolName: 'write' })
    await act(async () => { await Promise.resolve() })
    await probe.answer(0, 'rejected')
    expect(await answered).toBe('rejected')
    await probe.unmount()
  })

  it('holds several questions as a queue, oldest first', async () => {
    // A parallel tool batch asks more than once, so a single slot would drop
    // every question after the first and hang the calls behind them.
    const ctx = new Context()
    const probe = await mount(ctx)
    const first = ask(ctx, { toolName: 'shell' })
    const second = ask(ctx, { toolName: 'write' })
    await act(async () => { await Promise.resolve() })
    expect(probe.waiting()).toEqual(['shell', 'write'])

    await probe.answer(0, 'allowed-once')
    expect(await first).toBe('allowed-once')
    expect(probe.waiting()).toEqual(['write'])

    await probe.answer(0, 'rejected')
    expect(await second).toBe('rejected')
    expect(probe.waiting()).toEqual([])
    await probe.unmount()
  })

  it('declines a request aimed at another agent', async () => {
    // The listener is registered on the shared context, so a bundle running two
    // agents would otherwise have one terminal answering for both. Declining by
    // calling `next` leaves the rest of the chain — and the service's
    // fail-closed default — intact.
    const ctx = new Context()
    const probe = await mount(ctx)
    let outcome!: ApprovalOutcome
    await act(async () => {
      outcome = await ctx.waterfall(
        'approval/request',
        { agent: { id: 'other' }, toolName: 'shell' } as never,
        () => Promise.resolve<ApprovalOutcome>('unavailable'),
      )
    })
    expect(outcome).toBe('unavailable')
    expect(probe.waiting()).toEqual([])
    await probe.unmount()
  })

  it('withdraws a question whose request was aborted', async () => {
    // The turn can end under the question — Ctrl+C, a timeout — and the card
    // must vanish rather than wait for an answer nobody can act on.
    const ctx = new Context()
    const probe = await mount(ctx)
    const controller = new AbortController()
    const answered = ask(ctx, { toolName: 'shell', signal: controller.signal })
    await act(async () => { await Promise.resolve() })
    expect(probe.waiting()).toEqual(['shell'])

    await act(async () => {
      controller.abort()
      await Promise.resolve()
    })
    expect(await answered).toBe('cancelled')
    expect(probe.waiting()).toEqual([])
    await probe.unmount()
  })

  it('reports unavailable for a question still open at unmount', async () => {
    // A promise held past teardown wedges the turn forever with no UI left to
    // resolve it. `'unavailable'` is exactly what the service produces with no
    // answerer, so the call ends the same way it would have without this hook.
    const ctx = new Context()
    const probe = await mount(ctx)
    const answered = ask(ctx, { toolName: 'shell' })
    await act(async () => { await Promise.resolve() })
    await probe.unmount()
    expect(await answered).toBe('unavailable')
  })

  it('stops answering once unmounted', async () => {
    const ctx = new Context()
    const probe = await mount(ctx)
    await probe.unmount()
    const outcome = await ask(ctx, { toolName: 'shell' })
    expect(outcome).toBe('unavailable')
  })
})
