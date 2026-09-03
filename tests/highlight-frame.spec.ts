/**
 * Syntax highlighting, at the frame level.
 *
 * `highlight.spec.ts` proves the tokens are right. What only a composed frame
 * can show is that turning them into rows does not disturb the layout: a code
 * block draws plain until its grammar loads and colored afterwards, so those two
 * renderings have to occupy the same rows and carry the same characters. If they
 * did not, every code block would jump a beat after it appeared.
 * @module @deepseek-ai/dsh-tui/tests/highlight-frame.spec
 */

import { afterEach, describe, expect, it } from 'vitest'
import { paintApp, type Painted } from './fake-tty.ts'

const mounted: Painted[] = []

afterEach(() => {
  for (const app of mounted) app.unmount()
  mounted.length = 0
})

/** Mount an app, stream one fenced block into it, and let Shiki load. */
async function withBlock(lang: string, code: string): Promise<Painted> {
  const app = await paintApp({ rows: 40, columns: 100 })
  mounted.push(app)
  await app.stream(`\`\`\`${lang}\n${code}\n\`\`\``)
  // Shiki costs ~60ms to import and construct on first use, and the grammar
  // load is a further await. A 30ms settle lands before all of that.
  await app.settle(400)
  return app
}

const CODE = [
  'export function add(a: number, b: number) {',
  '',
  '  // a comment',
  '  return a + b',
  '}',
].join('\n')

describe('highlighted code blocks', () => {
  it('occupies exactly the rows the unhighlighted block does', async () => {
    // The two fences differ only in whether a grammar exists: `text` is in the
    // plain family and is never highlighted, so it renders the way every code
    // block rendered before this feature. Comparing against a live app rather
    // than against an earlier frame of the same app keeps the test off Shiki's
    // load timing, which is not something a frame assertion should depend on.
    const plain = await withBlock('text', CODE)
    const lit = await withBlock('ts', CODE)
    const rows = (app: Painted): number => app.screen().split('\n').length
    expect(rows(lit)).toBe(rows(plain))
  })

  it('loses no characters to the tokenizer', async () => {
    const app = await withBlock('ts', CODE)
    const screen = app.screen()
    for (const line of CODE.split('\n')) {
      if (line.trim() === '') continue
      expect(screen).toContain(line)
    }
  })

  it('keeps the fence label and the frame', async () => {
    const app = await withBlock('ts', CODE)
    const screen = app.screen()
    expect(screen).toContain('ts')
    expect(screen).toContain('╭')
    expect(screen).not.toContain('```')
  })

  it('leaves a fence with no language alone', async () => {
    const app = await withBlock('', 'just some text')
    expect(app.screen()).toContain('just some text')
  })
})
