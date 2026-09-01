/**
 * `/language` at the frame level: the catalog reaching the screen.
 *
 * The catalog's own parity is pinned in `i18n.spec.ts` and the command's
 * behaviour in `commands.spec.ts`; neither can see whether a component actually
 * reads from the catalog. A literal left behind in one component passes both of
 * those suites and still shows English on a Chinese screen — the only test that
 * catches it is one that paints the tree and reads the rows back.
 *
 * These cases also pin the two boundaries the design chose deliberately: the
 * default is English regardless of what is in `~/.dsh/tui.json` (the App takes
 * the language as a prop; only `index.ts` reads the file), and the banner does
 * not retranslate in place, because `<Static>` means "already written".
 * @module @deepseek-ai/dsh-tui/tests/language-frame.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { paintApp } from './fake-tty.ts'
import { catalog } from '../src/i18n.ts'

// `/language` persists the choice, and this suite runs `/language` for real. The
// write is stubbed so a test run never touches the developer's own
// `~/.dsh/tui.json` — the file's contents are `settings.spec.ts`'s subject,
// against temp homes; what this suite is about is the repaint. Everything else
// in `settings.ts` keeps its real implementation.
vi.mock('../src/settings.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/settings.ts')>(),
  writeSettings: vi.fn(() => true),
}))

describe('interface language', () => {
  it('paints an English frame when no language is given', async () => {
    // The whole test suite depends on this: the App defaults to English, so a
    // developer who switched their own copy to Chinese still sees the same
    // frames CI does.
    const painted = await paintApp()
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain(catalog('en').prompt.placeholder)
    expect(screen).toContain(catalog('en').banner.tip)
  })

  it('paints the prompt and the banner in Chinese when asked', async () => {
    const painted = await paintApp({ lang: 'zh' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain(catalog('zh').prompt.placeholder)
    expect(screen).toContain(catalog('zh').banner.tip)
    expect(screen).not.toContain(catalog('en').prompt.placeholder)
  })

  it('paints the status bar labels in Chinese once there is conversation', async () => {
    // The banner yields to the StatusBar as soon as the log is non-empty, so
    // these labels are only reachable with turns seeded.
    const painted = await paintApp({ lang: 'zh', turns: 1 })
    const screen = painted.screen()
    painted.unmount()

    const zh = catalog('zh').status
    expect(screen).toContain(zh.session)
    expect(screen).toContain(zh.input)
    expect(screen).toContain(zh.output)
    expect(screen).not.toContain(catalog('en').status.session)
  })

  it('translates the transcript labels, not the identifiers in them', async () => {
    const painted = await paintApp({ lang: 'zh', turns: 1 })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain(catalog('zh').entries.assistant)
    // The model id is a name, not prose, and stays as the provider spells it.
    expect(screen).toContain('deepseek-v4-flash')
  })

  it('keeps every row inside the frame width in Chinese', async () => {
    // A CJK glyph is two columns wide. Any row wider than the terminal gets
    // wrapped by the terminal, and Ink erases by logical line count, so the
    // extra physical row survives every redraw. Measured in columns rather than
    // characters for exactly that reason.
    const columns = 80
    const painted = await paintApp({ lang: 'zh', columns, turns: 1 })
    const rows = painted.screen().split('\n')
    painted.unmount()

    for (const row of rows) {
      // `displayWidth` is the same measure the layout code budgets against.
      const { displayWidth } = await import('../src/width.ts')
      expect(displayWidth(row)).toBeLessThanOrEqual(columns)
    }
  })

  it('switches the live frame when /language runs, banner excepted', async () => {
    const painted = await paintApp()
    await painted.send('/language zh')
    await painted.send('\r')
    const screen = painted.screen()
    painted.unmount()

    // The chrome follows immediately.
    expect(screen).toContain(catalog('zh').prompt.placeholder)
    // The confirmation is written in the language just switched to.
    expect(screen).toContain(catalog('zh').output.languageSwitched)
    // The banner is gone, not translated: the log now holds the command entry,
    // so the StatusBar has taken over the header row. It returns in Chinese on
    // the next `/clear`.
    expect(screen).not.toContain(catalog('en').banner.tip)
  })

  it('reports an unknown language without changing the frame', async () => {
    const painted = await paintApp()
    await painted.send('/language fr')
    await painted.send('\r')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('fr')
    expect(screen).toContain(catalog('en').prompt.placeholder)
    expect(screen).not.toContain(catalog('zh').prompt.placeholder)
  })
})
