/**
 * Reading the session's effective permission preset.
 *
 * A preset bundles the two independent permission knobs the harness has —
 * sandbox mode (`read-only | workspace-write | danger-full-access`) and
 * approval policy (`ask | never`) — into one word. `dsh-permission-presets`
 * owns the folding as the `permissions` **session projection**, keyed by the
 * three whole-value events `permission/preset`, `sandbox/mode` and
 * `approval/policy`; the read face is `ctx.sessionProjections.snapshot()`.
 *
 * Neither that package nor `dsh-session-projection` is a dependency — see the
 * copied vocabulary in `types.ts` — so everything here is an optional,
 * shape-checked read off the service store. An assembly that mounts neither
 * simply has no chip, which is also the honest answer it would give any other
 * client.
 * @module @deepseek-ai/dsh-tui/commands/permissions
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  DANGER_PRESET,
  type PermissionPresetSelect,
  type PermissionProjectionReader,
} from '../core/types.ts'

/**
 * The durable events that can move the effective preset. The projection unit
 * folds exactly these three, so they are the only events a view has to
 * re-read after. The first two belong to packages this build does not type,
 * which is why the list is `string` rather than the event union.
 */
export const PERMISSION_EVENTS: readonly string[] = [
  'permission/preset',
  'sandbox/mode',
  'approval/policy',
]

/** Narrow an untyped projection value to the shape the chip renders. */
function asPermissionSelect(value: unknown): PermissionPresetSelect | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { currentValue?: unknown; options?: unknown }
  if (typeof candidate.currentValue !== 'string') return undefined
  if (!Array.isArray(candidate.options)) return undefined
  if (!candidate.options.every(option =>
    typeof option === 'object'
    && option !== null
    && typeof (option as { value?: unknown }).value === 'string'
    && typeof (option as { name?: unknown }).name === 'string')) {
    return undefined
  }
  return candidate as unknown as PermissionPresetSelect
}

/**
 * Read the session's effective permission preset from the projection service.
 *
 * The read is synchronous and consistent: the registry folds lazily over the
 * in-memory log on demand, so the value returned is current as of the session
 * events already delivered.
 * @param ctx - the context the service may be mounted on.
 * @param session - whose effective preset is being read.
 * @returns the advertised options and current value, or `undefined` when no
 *   projection service is mounted or it carries no `permissions` unit.
 */
export function readPermissionPreset(
  ctx: Context,
  session: unknown,
): PermissionPresetSelect | undefined {
  // `sessionProjections` is not in this build's typed `Context` merge (its
  // package is not a dependency), so the read goes through the string-keyed
  // `get` the same way `appExit` does in `services.ts`.
  const registry = ctx.get('sessionProjections') as PermissionProjectionReader | undefined
  if (registry === undefined) return undefined
  try {
    const snapshot = registry.snapshot(session)
    return asPermissionSelect(snapshot.values.permissions)
  } catch {
    // A projection unit's schema can throw on a payload another plugin wrote;
    // the chip is chrome, not the answer to a command — degrade to absent.
    return undefined
  }
}

/**
 * Whether the current preset is the open-sandbox, never-ask stance.
 *
 * The match is against dsh-base's table key, not a semantic read of the two
 * knobs: those events' vocabulary belongs to packages this build does not
 * depend on, and a deployment that renames the preset simply loses the red
 * treatment while keeping the chip.
 * @param select - the current projection value.
 * @returns whether the StatusBar must paint it as a danger state.
 */
export function isDangerPreset(select: PermissionPresetSelect): boolean {
  return select.currentValue === DANGER_PRESET
}
