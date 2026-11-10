import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import stringWidth from 'string-width'
import { patchInkOutput } from '../scripts/ink-unicode.mjs'

const require = createRequire(import.meta.url)
const inkRoot = dirname(dirname(require.resolve('ink')))
const version = (JSON.parse(readFileSync(join(inkRoot, 'package.json'), 'utf8')) as { version: string }).version
const original = readFileSync(join(inkRoot, 'build/output.js'), 'utf8')
interface Output {
  write(x: number, y: number, text: string, options: { transformers: never[] }): void
  clip(options: { x1: number; x2: number; y1?: number; y2?: number }): void
  get(): { output: string; height: number }
}
async function output(width: number): Promise<Output> {
  const code = patchInkOutput(original, version).replace(/from '([^']+)'/g, (_whole, name: string) => {
    const root = join(inkRoot, '..', name)
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports?: string | { '.': string | { import?: string; default?: string } }
      module?: string
      main?: string
    }
    const entry = typeof manifest.exports === 'string' ? manifest.exports : manifest.exports?.['.']
    const file = typeof entry === 'string' ? entry : entry?.import ?? entry?.default ?? manifest.module ?? manifest.main ?? 'index.js'
    return `from '${pathToFileURL(join(root, file)).href}'`
  })
  const module = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`) as {
    default: new (options: { width: number; height: number }) => Output
  }
  return new module.default({ width, height: 1 })
}
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

describe('Ink Unicode output compatibility', () => {
  it('keeps complete emoji and combining graphemes inside a clipped row', async () => {
    const screen = await output(10)
    screen.clip({ x1: 0, x2: 10 })
    screen.write(0, 0, 'a👨‍👩‍👧‍👦éz', { transformers: [] })
    screen.write(9, 0, '│', { transformers: [] })
    expect(plain(screen.get().output)).toBe('a👨‍👩‍👧‍👦éz    │')
    expect(stringWidth(screen.get().output)).toBe(10)
  })

  it('keeps ANSI styles inside a grapheme and resets them before its neighbors', async () => {
    const screen = await output(5)
    screen.clip({ x1: 0, x2: 5 })
    screen.write(0, 0, '\u001b[31me\u001b[1ḿ\u001b[22m\u001b[39m👨‍👩‍👧‍👦z', { transformers: [] })
    const result = screen.get().output
    expect(plain(result)).toBe('é👨‍👩‍👧‍👦z')
    expect(result).toContain('\u001b[31m')
    expect(result).toContain('\u001b[1m')
    expect(result).toContain('\u001b[22m')
    expect(result).toContain('\u001b[39m')
    expect(stringWidth(result)).toBe(4)
  })

  it('fills a partially clipped wide grapheme without emitting half a cluster', async () => {
    const screen = await output(5)
    screen.clip({ x1: 1, x2: 3 })
    screen.write(0, 0, '👨‍👩‍👧‍👦ab', { transformers: [] })
    screen.write(4, 0, '|', { transformers: [] })
    expect(plain(screen.get().output)).toBe('  a')
  })

  it('refuses an unreviewed Ink version or changed upstream implementation', () => {
    expect(() => patchInkOutput(original, '5.3.0')).toThrow('5.2.1')
    expect(() => patchInkOutput('export default class Output {}', '5.2.1')).toThrow()
  })
})
