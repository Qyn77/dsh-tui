/**
 * What `/plugins` knows: which plugins the loader has, and how each one is
 * doing.
 *
 * The loader is the authority and is read fresh on every call — nothing here
 * caches. Cordis already maintains `Entry.fiber` and `Fiber.state` through its
 * `internal/plugin` and `internal/status` events, so a cache in this package
 * could only ever be a second, staler copy of a table that is already correct.
 *
 * The rows are described here rather than in the command so the ordering and
 * the classification can be tested by calling them (SPEC §3.4). The one thing
 * this module cannot check for itself is the phase numbering — see
 * {@link FIBER_PHASE}.
 * @module @deepseek-ai/dsh-tui/plugins
 */

/** How a plugin is doing, from the loader's point of view. */
export type PluginPhase =
  | 'active'
  | 'loading'
  | 'pending'
  | 'failed'
  | 'unloading'
  /** Switched off in the config; it has no fiber and that is not an error. */
  | 'disabled'
  /** Enabled, but the loader never produced a fiber — usually a failed import. */
  | 'absent'

/**
 * `FiberState` by its numeric value.
 *
 * Cordis declares `FiberState` as a `const enum`, which has no runtime
 * representation and is not in the package's export list, so it cannot be
 * imported and read. Every dsh package that needs it mirrors these numbers by
 * hand; this is that mirror. **If cordis reorders the enum, this table is
 * wrong and nothing will fail to compile** — the phase labels will simply lie.
 * `DISPOSED` (4) is deliberately absent: a disposed fiber is unreachable
 * through `loader.entries()`, so seeing one would mean the model here is wrong.
 */
const FIBER_PHASE: readonly (PluginPhase | undefined)[] = [
  'pending',
  'loading',
  'active',
  'failed',
  undefined,
  'unloading',
]

/**
 * As much of the loader's `Entry` as this module reads.
 *
 * Structural, not imported: the real type drags in the loader's whole
 * `EntryTree`, and a test would then have to build one to say anything about
 * ordering. Only these four fields are used, and a real `Entry` satisfies them.
 */
export interface LoaderEntry {
  /** Fully-qualified config id, e.g. `include:a1b2c3d4`. */
  id: string
  /** Effective, with the ancestor groups' state already folded in. */
  disabled: boolean
  options: {
    /** The module specifier — the closest thing to a package name there is. */
    name?: string | null | undefined
    /** Groups are containers, not plugins. Config-shaped, hence the `null`. */
    group?: boolean | null | undefined
  }
  fiber?: { state: number } | undefined
}

/** One plugin, as `/plugins` reports it. */
export interface PluginRow {
  /** Module specifier, or the config id when the entry has no name. */
  name: string
  /** Config id, which is what a user would edit or disable. */
  id: string
  phase: PluginPhase
}

/** Sort key: the phases a user opened `/plugins` to find come first. */
const SEVERITY: Record<PluginPhase, number> = {
  failed: 0,
  absent: 0,
  pending: 1,
  loading: 1,
  unloading: 1,
  active: 2,
  disabled: 3,
}

/**
 * Describe the loader's entries, most interesting first.
 *
 * Groups are skipped: they are containers for other entries, and listing them
 * beside real plugins would make the count wrong. Failed and absent entries
 * sort to the top because someone typing `/plugins` is far more often asking
 * "why isn't X working" than "what is loaded"; disabled ones sink, because
 * they are the rows the user already knows about.
 * @param entries - `ctx.loader.entries()`, or anything shaped like it.
 */
export function describePlugins(entries: Iterable<LoaderEntry>): PluginRow[] {
  const rows: PluginRow[] = []
  for (const entry of entries) {
    if (entry.options.group === true) continue
    rows.push({
      name: entry.options.name ?? entry.id,
      id: entry.id,
      phase: phaseOf(entry),
    })
  }
  return rows.sort((a, b) => SEVERITY[a.phase] - SEVERITY[b.phase] || a.name.localeCompare(b.name))
}

/** Classify one entry. Disabled wins: a switched-off plugin has no fiber by design. */
function phaseOf(entry: LoaderEntry): PluginPhase {
  if (entry.disabled) return 'disabled'
  if (entry.fiber === undefined) return 'absent'
  return FIBER_PHASE[entry.fiber.state] ?? 'absent'
}

/** The glyph column. Language-independent, like the rest of this app's glyphs. */
const GLYPH: Record<PluginPhase, string> = {
  active: '✓',
  loading: '·',
  pending: '·',
  unloading: '·',
  failed: '✗',
  absent: '✗',
  disabled: '○',
}

/**
 * Render the rows as a two-column table.
 *
 * Module specifiers are ASCII, so `padEnd` on character count is display-column
 * padding here — the same assumption `helpText` makes about command names, and
 * for the same reason.
 * @param rows - output of {@link describePlugins}.
 * @param labels - one translated word per phase.
 */
export function formatPlugins(
  rows: readonly PluginRow[],
  labels: Record<PluginPhase, string>,
): string {
  const nameCol = Math.max(0, ...rows.map(row => row.name.length))
  return rows
    .map(row => `  ${GLYPH[row.phase]} ${row.name.padEnd(nameCol)}  ${labels[row.phase]}`)
    .join('\n')
}
