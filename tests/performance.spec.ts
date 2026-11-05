/** Opt-in reproducible performance budgets; normal unit tests stay timing-independent. */
import { expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { writeFileSync } from 'node:fs'
import { paintApp, ESC } from './fake-tty.ts'
import { searchTranscript } from '../src/commands/transcript.ts'
import { commandMenus } from '../src/pickers/command-menu.ts'
import { catalog } from '../src/core/i18n.ts'
import { createEntryRowEstimator } from '../src/render/scroll.ts'
import type { UiEntry } from '../src/core/types.ts'

const benchmark = process.env['DSH_TUI_BENCH'] === '1' ? it : it.skip
benchmark('measures large history, menus, input, scroll and sustained streaming', async () => {
  const baseline = process.memoryUsage().heapUsed
  const samples: Record<string, number[]> = {}
  const measure = async (name: string, action: () => unknown) => {
    const start = performance.now(); await action(); (samples[name] ??= []).push(performance.now() - start)
  }
  const entries: UiEntry[] = Array.from({ length: 10_000 }, (_, i) => ({ kind: 'assistant', turn: i + 1,
    step: 1, finalized: true, text: `message ${i} 中文 needle ${'output '.repeat(i % 100 === 0 ? 5000 : 20)}` }))
  const state = { entries, status: 'idle' as const, currentTurn: 10_000 }
  const estimate = createEntryRowEstimator(100, false)
  for (let i = 0; i < 8; i++) {
    await measure('search10k', () => searchTranscript(entries, 'needle'))
    await measure('menu10k', () => commandMenus(catalog('en'), {}, { root: '/inspect', state }))
    await measure('rows10k', () => { for (const entry of entries) estimate(entry) })
  }
  let app: Awaited<ReturnType<typeof paintApp>> | undefined
  try {
    await measure('startup2k', async () => { app = await paintApp({ turns: 1000, rows: 31, columns: 100 }) })
    const tty = app!
    for (let i = 0; i < 20; i++) await measure('input', () => tty.send('x'))
    for (let i = 0; i < 10; i++) await measure('scroll', () => tty.send(`${ESC}[5~`))
    await measure('searchOpen', () => tty.send(`${ESC}OR`))
    await tty.send(ESC); await tty.settle(60)
    for (let i = 0; i < 30; i++) await measure('stream', () => tty.stream(`chunk ${i} ${'x'.repeat(1000)}`, { turn: 1001, step: 1 }))
    expect(tty.screen().split('\n').length).toBeLessThanOrEqual(31)
  } finally { app?.unmount() }
  const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
  const timings = Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, Math.round(p95(values) * 10) / 10]))
  const heapGrowthMiB = Math.round((process.memoryUsage().heapUsed - baseline) / 1024 / 1024)
  const budgets = { search10k: 150, menu10k: 250, rows10k: 500, startup2k: 5000, input: 150, scroll: 200, searchOpen: 300, stream: 200 }
  const report = { node: process.version, platform: process.platform, arch: process.arch,
    note: 'Ink frame timings include the harness 30ms settle; no model or network. Heap growth includes retained test frames.',
    timingsP95Ms: timings, heapGrowthMiB, budgetsMs: budgets, heapBudgetMiB: 256 }
  if (process.env['DSH_TUI_BENCH_REPORT']) writeFileSync(process.env['DSH_TUI_BENCH_REPORT'], JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  for (const [name, budget] of Object.entries(budgets)) expect(timings[name], name).toBeLessThan(budget)
  expect(heapGrowthMiB).toBeLessThan(256)
}, 30_000)
