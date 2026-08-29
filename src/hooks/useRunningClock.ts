/**
 * Drives the animated "thinking" indicator (spinner glyph + elapsed
 * seconds) used by {@link StatusBar} and {@link Prompt} while a turn
 * is running. Both consumers tick off the same interval so the glyph
 * and the counter stay in lock-step, and so the App root can pass the
 * result down as plain props instead of reaching for a context.
 *
 * The hook is intentionally simple: one `setInterval` per mount and an 80ms
 * tick (spinner cycle ≈ 0.8s).
 *
 * The elapsed-seconds counter is written only when the integer second changes.
 * That gate used to be described here as saving a re-render twelve times a
 * second, which is not true and is worth correcting rather than repeating: the
 * spinner index changes on *every* tick, so the component re-renders at the
 * tick rate no matter what this counter does. What the gate actually avoids is
 * a redundant state write per tick. It is kept because that is still the
 * correct thing to do, not because it buys a frame.
 * @module @deepseek-ai/dsh-tui/hooks/useRunningClock
 */

import { useEffect, useState } from 'react'

/** The Braille pattern spinner frames, one per 80ms tick. */
export const SPINNER_FRAMES: readonly string[] = [
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
]

/** Tick rate in milliseconds. 80ms gives a ~12.5 fps cycle that is
 *  smooth on every terminal we have tried without burning CPU on a
 *  background loop the user is not even looking at. */
const TICK_MS = 80

/** Output of {@link useRunningClock}. Both fields are 0 when not running. */
export interface RunningClock {
  /** Index into {@link SPINNER_FRAMES}; consumers render the glyph. */
  spinnerFrame: number
  /** Whole seconds since the most recent `running` transition. */
  elapsedSeconds: number
}

/**
 * Returns the current spinner frame index and elapsed-seconds counter
 * for a `running` boolean. Both reset to 0 when `running` flips back
 * to false. One interval is created on each `running = true`
 * transition and torn down on the next status change or unmount, so
 * idle turns do not pay the timer cost.
 */
export function useRunningClock(running: boolean): RunningClock {
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!running) {
      // Reset on idle so a re-render does not flash the previous run's
      // frame / counter to the user for a tick before the next turn.
      setSpinnerFrame(0)
      setElapsedSeconds(0)
      return
    }
    const startedAt = Date.now()
    let lastElapsed = -1
    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length)
      const seconds = Math.floor((Date.now() - startedAt) / 1000)
      if (seconds !== lastElapsed) {
        lastElapsed = seconds
        setElapsedSeconds(seconds)
      }
    }, TICK_MS)
    // The braces matter: an arrow that *returns* `clearInterval(...)` hands
    // React the Timeout as the cleanup's return value, and React only accepts
    // a cleanup function or undefined there.
    return () => {
      clearInterval(interval)
    }
  }, [running])

  return { spinnerFrame, elapsedSeconds }
}
