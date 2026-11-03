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
 * rc.5 exposes the effective selection per Session and selectable options in
 * a process-wide catalog through the permissionPresets service.
 * @module @qiao-qyn/dsh-tui/commands/permissions
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type { Context } from '@deepseek-ai/cordis'
import {
  DANGER_PRESET,
  type PermissionPresetSelect,
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
  session: Session,
): PermissionPresetSelect | undefined {
  const presets = ctx.get('permissionPresets')
  if (!presets) return undefined
  try {
    return asPermissionSelect({ currentValue: presets.current(session), options: presets.catalog().options })
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
