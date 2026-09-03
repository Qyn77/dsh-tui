/**
 * `/theme` at the frame level: the preference reaching the screen and staying
 * there.
 *
 * These tests do not assert a single color, and that is deliberate rather than a
 * gap. chalk's color level is 0 under vitest, so no frame in this suite carries
 * an SGR sequence to assert on — the same reason `highlight-frame.spec.ts`
 * checks row counts instead of hex values. What *is* observable in text is the
 * loop that matters: the setting the user chose is the setting the app reports
 * back on the next `/theme`, which is the whole contract of a persisted
 * preference. Whether the resulting hex is legible on a real white background is
 * a real-TTY judgement, per roadmap §7.
 * @module @deepseek-ai/dsh-tui/tests/theme-frame.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { paintApp } from './fake-tty.ts'
import { catalog } from '../src/i18n.ts'

// `/theme` persists, and this suite runs it for real. Stubbed for the reason
// `language-frame.spec.ts` gives: a test run must not rewrite the developer's
// own `~/.dsh/tui.json`. The file's contents are `settings.spec.ts`'s subject.
vi.mock('../src/settings.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/settings.ts')>(),
  writeSettings: vi.fn(() => true),
}))

/** The rows of a frame, blanks dropped. */
function screenOf(text: string): string {
  return text.split('\n').map(line => line.trimEnd()).filter(line => line !== '').join('\n')
}

describe('/theme', () => {
  it('reports the detected appearance under auto', async () => {
    const painted = await paintApp({ appearance: 'light', themePref: 'auto' })
    await painted.send('/theme')
    await painted.send('\r')
    const screen = screenOf(painted.screen())
    painted.unmount()

    expect(screen).toContain('auto')
    // The measurement, which is the part "auto" does not tell the user.
    expect(screen).toContain('light')
  })

  it('remembers an explicit choice across the next query', async () => {
    // The loop a persisted preference is for: choose, then ask, and be told
    // what you chose rather than what the terminal thinks.
    const painted = await paintApp({ appearance: 'dark' })
    await painted.send('/theme light')
    await painted.send('\r')
    await painted.send('/theme')
    await painted.send('\r')
    const screen = screenOf(painted.screen())
    painted.unmount()

    expect(screen).toContain('Current: light')
    expect(screen).not.toContain('Current: auto')
  })

  it('goes back to auto and reports the measurement again', async () => {
    const painted = await paintApp({ appearance: 'light', themePref: 'light' })
    await painted.send('/theme auto')
    await painted.send('\r')
    const screen = screenOf(painted.screen())
    painted.unmount()

    expect(screen).toContain(catalog('en').output.themeSwitched('auto', 'light'))
  })

  it('reports an unknown theme without changing anything', async () => {
    const painted = await paintApp({ themePref: 'auto' })
    await painted.send('/theme solarized')
    await painted.send('\r')
    await painted.send('/theme')
    await painted.send('\r')
    const screen = screenOf(painted.screen())
    painted.unmount()

    expect(screen).toContain('solarized')
    expect(screen).toContain('Current: auto')
  })

  it('keeps the frame width when the appearance changes', async () => {
    // The appearance changes colors and nothing else. A palette that somehow
    // changed a row's length would break the erase arithmetic the same way an
    // over-wide banner row does — see Part 1 rule 7.
    const columns = 80
    const { displayWidth } = await import('../src/width.ts')
    for (const appearance of ['dark', 'light'] as const) {
      const painted = await paintApp({ appearance, columns, turns: 1 })
      const rows = painted.screen().split('\n')
      painted.unmount()
      for (const row of rows) expect(displayWidth(row)).toBeLessThanOrEqual(columns)
    }
  })

  it('paints the same rows either way, since only colors differ', async () => {
    const dark = await paintApp({ appearance: 'dark', turns: 1 })
    const darkRows = screenOf(dark.screen())
    dark.unmount()
    const light = await paintApp({ appearance: 'light', turns: 1 })
    const lightRows = screenOf(light.screen())
    light.unmount()

    expect(lightRows).toBe(darkRows)
  })
})
