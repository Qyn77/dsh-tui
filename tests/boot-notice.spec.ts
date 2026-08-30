/**
 * The boot notice, on screen. A resume that could not be honoured has exactly
 * one place to say so — the transcript — because the runner writes it before
 * Ink's first frame and the alternate screen erases anything on stderr from
 * there. So the property under test is not the string but its survival: it has
 * to reach a frame, and it has to reach it once.
 * @module @deepseek-ai/dsh-tui/tests/boot-notice.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

const NOTICE = 'Cannot resume: no stored sessions yet.'

describe('boot notice', () => {
  it('shows the notice above the first turn', async () => {
    const view = await paintApp({ notice: NOTICE })
    expect(view.screen()).toContain('Cannot resume')
    view.unmount()
  })

  it('shows it once, not once per render', async () => {
    // Appended from an effect, so a dependency list that saw the notice as new
    // work on every render would stack copies of it as the user typed.
    const view = await paintApp({ notice: NOTICE })
    await view.send('hello')
    const occurrences = view.screen().split('Cannot resume').length - 1
    expect(occurrences).toBe(1)
    view.unmount()
  })

  it('draws nothing extra without one', async () => {
    const view = await paintApp({})
    expect(view.screen()).not.toContain('Cannot resume')
    view.unmount()
  })
})
