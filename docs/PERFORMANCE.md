# Reproducible long-session budgets

Run `node scripts/performance-check.mjs` (or `pnpm test:performance`). Optional
`DSH_TUI_BENCH_REPORT=/tmp/dsh-performance.json` writes the same JSON report.
The opt-in suite is skipped during normal unit tests; timing is not a unit-test
correctness oracle. No network, model, personal session or clipboard is used.

Dataset: 10,000 immutable transcript entries with CJK and 100 large outputs
(~35 KB each); eight search/menu/layout runs. Real Ink frame harness: 1,000
completed turns (2,000 messages), 20 input events, ten page scrolls, search-menu
opening and 30 streaming chunks of 1 KB. Frame timings include the harness's
30 ms settling interval, so they are an upper bound rather than CPU-only time.
Heap growth includes the fixture and retained output frames, without forced GC.

Measured 2026-11-06, macOS arm64, Node 22.23.1:

| Operation | p95 ms | Budget ms |
| --- | ---: | ---: |
| Search 10k entries | 13.5 | 150 |
| Build 10k message choices | 62.4 | 250 |
| Estimate 10k rows (includes cold run) | 5.3 | 500 |
| Mount 2k messages | 113.4 | 5000 |
| Input | 36.4 | 150 |
| Page scroll | 42.2 | 200 |
| Search open | 36.6 | 300 |
| Streaming frame | 96.4 | 200 |

Heap growth: 184 MiB / 256 MiB budget. All budgets passed; no durable-history
truncation was introduced. These numbers describe this machine and harness,
not native-terminal frame latency or a universal memory guarantee. Run the
same benchmark when changing projection, row measurement, menus or streaming.
