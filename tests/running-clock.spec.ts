/**
 * `useRunningClock` — the only hook in the package that owns a timer, and the
 * one whose behaviour no frame assertion can see. A screenshot shows one glyph
 * at one instant; what matters here is the sequence: that the spinner advances
 * and wraps, that the elapsed counter is gated on the integer second changing
 * rather than firing every 80ms tick, that both reset when the turn ends, and
 * that the interval is actually torn down.
 *
 * The hook is driven through a mounted Ink probe rather than a bare renderer,
 * because it is `useEffect` + `setInterval` and both need a real commit. Timers
 * are faked so a test asserting "still 0 after 900ms" does not cost 900ms; the
 * probe advances them inside `act` so React flushes the resulting renders.
 *
 * One behaviour here is deliberately *not* covered: the integer-second gate on
 * the elapsed counter. Deleting it leaves every test below green, and that is
 * correct rather than a hole — the spinner index changes on every tick, so the
 * component re-renders at the tick rate regardless, and the gate only avoids a
 * redundant state write. There is no observable behaviour to assert. Writing a
 * test that appeared to cover it would be worse than admitting the gap.
 * @module @deepseek-ai/dsh-tui/tests/running-clock.spec
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, Text } from 'ink'
import { useRunningClock, SPINNER_FRAMES, type RunningClock } from '../src/hooks/useRunningClock.ts'
import { fakeStdout } from './fake-tty.ts'

// React 18.3 exports `act` from the root package. `react-dom/test-utils` is the
// usual source but is not installed here and would be wrong anyway: Ink brings
// its own reconciler, so there is no react-dom in this tree at all.
const { act } = React

/** A mounted probe over the hook. */
interface Probe {
  /** The latest value the hook returned. */
  clock: () => RunningClock
  /** Advance fake time by `ms`, flushing every render it causes. */
  tick: (ms: number) => Promise<void>
  /** Re-render with a different `running`, the way a `turn/end` would. */
  setRunning: (running: boolean) => Promise<void>
  unmount: () => void
}

async function mount(running: boolean): Promise<Probe> {
  let captured: RunningClock | undefined
  const Probe: React.FC<{ running: boolean }> = ({ running: current }) => {
    captured = useRunningClock(current)
    return React.createElement(Text, null, 'probe')
  }
  const element = (flag: boolean): React.ReactElement =>
    React.createElement(Probe, { running: flag })
  const instance = render(element(running), {
    stdout: fakeStdout(80, 10) as never,
    patchConsole: false,
    debug: true,
  })

  const flush = async (fn: () => void): Promise<void> => {
    await act(async () => {
      fn()
      await Promise.resolve()
    })
  }
  await flush(() => {})

  return {
    clock: () => {
      if (captured === undefined) throw new Error('hook never ran')
      return captured
    },
    async tick(ms) {
      await flush(() => { vi.advanceTimersByTime(ms) })
    },
    async setRunning(next) {
      await flush(() => { instance.rerender(element(next)) })
    },
    unmount: () => { instance.unmount() },
  }
}

describe('useRunningClock', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('sits at zero while the agent is idle', async () => {
    const probe = await mount(false)
    await probe.tick(5_000)
    expect(probe.clock()).toEqual({ spinnerFrame: 0, elapsedSeconds: 0 })
    probe.unmount()
  })

  it('advances one spinner frame per 80ms tick', async () => {
    const probe = await mount(true)
    await probe.tick(80 * 3)
    expect(probe.clock().spinnerFrame).toBe(3)
    probe.unmount()
  })

  it('wraps the spinner frame back to the first glyph', async () => {
    const probe = await mount(true)
    // One full cycle plus one tick: the index must be 1, not SPINNER_FRAMES.length + 1,
    // or the consumers would index past the end of the frame table and render undefined.
    await probe.tick(80 * (SPINNER_FRAMES.length + 1))
    expect(probe.clock().spinnerFrame).toBe(1)
    probe.unmount()
  })

  it('holds the seconds counter at zero until a whole second has passed', async () => {
    const probe = await mount(true)
    await probe.tick(900)
    expect(probe.clock().elapsedSeconds).toBe(0)
    probe.unmount()
  })

  it('counts whole seconds once they elapse', async () => {
    const probe = await mount(true)
    await probe.tick(2_100)
    expect(probe.clock().elapsedSeconds).toBe(2)
    probe.unmount()
  })

  it('resets both values when the turn ends', async () => {
    const probe = await mount(true)
    await probe.tick(2_100)
    expect(probe.clock().elapsedSeconds).toBe(2)
    await probe.setRunning(false)
    // Reset on idle, not on the next start: leaving the last run's frame and
    // counter in place would flash them at the user for a tick when the next
    // turn begins.
    expect(probe.clock()).toEqual({ spinnerFrame: 0, elapsedSeconds: 0 })
    probe.unmount()
  })

  it('restarts the counter from zero on the next turn', async () => {
    const probe = await mount(true)
    await probe.tick(3_100)
    await probe.setRunning(false)
    await probe.setRunning(true)
    await probe.tick(1_100)
    expect(probe.clock().elapsedSeconds).toBe(1)
    probe.unmount()
  })

  it('clears the interval when the turn ends', async () => {
    const probe = await mount(true)
    await probe.tick(80)
    await probe.setRunning(false)
    // If the effect returned a value React could not use as a cleanup — the
    // trap the hook's comment records — the interval would outlive the turn and
    // keep pushing frames into an idle status bar.
    expect(vi.getTimerCount()).toBe(0)
    probe.unmount()
  })

  it('clears the interval on unmount', async () => {
    const probe = await mount(true)
    await probe.tick(80)
    probe.unmount()
    await act(async () => { await Promise.resolve() })
    expect(vi.getTimerCount()).toBe(0)
  })
})
