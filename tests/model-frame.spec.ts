/**
 * Frame tests for the `/model ` picker: it opens on the anchored token with
 * the live model ticked, filters by the typed id, fills on Tab, switches on
 * Enter through the ordinary `/model` dispatch, and stays absent without an
 * `llm` service or a catalogue. The provider round-trip is async, so every
 * mount that opens the picker waits out the fake listing the way the skill
 * picker waits out its catalog.
 *
 * @module @deepseek-ai/dsh-tui/tests/model-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { ESC, paintApp } from './fake-tty.ts'

/** The fake selection boots on the flash model; the catalogue has three. */
const CATALOGUE = ['deepseek-v4-flash', 'deepseek-v4', 'deepseek-r2'] as const

/** Wait out the async `listModels` round-trip and the rows effect. */
async function openPicker(
  painted: Awaited<ReturnType<typeof paintApp>>,
  token = '',
): Promise<void> {
  await painted.send(`/model ${token}`)
  await painted.settle(50)
}

describe('the /model picker', () => {
  it('lists the provider catalogue with the live model ticked', async () => {
    const painted = await paintApp({ models: CATALOGUE })
    await openPicker(painted)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('deepseek-v4-flash')
    expect(screen).toContain('name of deepseek-v4')
    expect(screen).toContain('deepseek-r2')
    expect(screen).toContain('✓ name of deepseek-v4-flash')
    // Exactly one tick: `✓ name of deepseek-v4` is a substring of the flash
    // row, so a plain `not.toContain` cannot tell the two apart.
    expect(screen.indexOf('✓')).toBe(screen.lastIndexOf('✓'))
    expect(screen).toContain('Enter switch')
  })

  it('filters by the id being typed', async () => {
    const painted = await paintApp({ models: CATALOGUE })
    await openPicker(painted, 'deepseek-r')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('name of deepseek-r2')
    expect(screen).not.toContain('name of deepseek-v4')
  })

  it('fills the line on Tab without sending', async () => {
    const painted = await paintApp({ models: CATALOGUE })
    await openPicker(painted, 'deepseek-r')
    await painted.send('\t')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('/model deepseek-r2 ')
    expect(screen).not.toContain('Enter switch')
  })

  it('switches through the ordinary /model dispatch on Enter', async () => {
    const painted = await paintApp({ models: CATALOGUE })
    await openPicker(painted, 'deepseek-r')
    await painted.send('\r')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    // The command echo and the switch report, plus the StatusBar now naming
    // the new model — the switch went through the same dispatch a typed
    // `/model deepseek-r2` takes.
    expect(screen).toContain('/model deepseek-r2')
    expect(screen).toContain('deepseek-official/deepseek-r2')
    expect(screen).not.toContain('Enter switch')
  })

  it('dismisses once on Esc without losing the token', async () => {
    const painted = await paintApp({ models: CATALOGUE })
    await openPicker(painted, 'v4')
    await painted.send(ESC)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Enter switch')
    expect(screen).toContain('/model v4')
  })

  it('opens when bare /model is chosen from the / palette on Enter', async () => {
    const painted = await paintApp({ models: CATALOGUE })
    await painted.send('/model')
    await painted.send('\r')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('Enter switch')
    // The usage answer did not run; the picker's rows did.
    expect(screen).not.toContain('Usage: /model')
    expect(screen).toContain('name of deepseek-r2')
  })

  it('stays closed with no llm service, and bare /model then prints usage', async () => {
    const painted = await paintApp()
    await painted.send('/model')
    await painted.send('\r')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Enter switch')
    expect(screen).toContain('Usage: /model')
  })

  it('stays closed when the catalogue answers empty', async () => {
    const painted = await paintApp({ models: [] })
    await openPicker(painted)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Enter switch')
  })
})
