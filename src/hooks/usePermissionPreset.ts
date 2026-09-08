/**
 * Track the session's effective permission preset for the StatusBar chip.
 *
 * The projection registry folds synchronously over the in-memory log, so this
 * holds no mathematics of its own: it reads once, then re-reads whenever one
 * of the three knob events (`permissions.ts`) lands on the agent's own
 * session. `/permission` appends exactly those through
 * `dsh-permission-presets`, which is the whole reason a subscription is
 * enough and a polling interval is not.
 *
 * The service is optional — an assembly without `dsh-session-projection` or
 * without a registered `permissions` unit yields `undefined`, and the chrome
 * draws no chip rather than guessing a stance the deployment did not state.
 * @module @deepseek-ai/dsh-tui/hooks/usePermissionPreset
 */

import { useEffect, useState } from 'react'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { PERMISSION_EVENTS, readPermissionPreset } from '../permissions.ts'
import type { PermissionPresetSelect } from '../types.ts'

/**
 * Whether two reads describe the same chip. The registry builds a fresh
 * snapshot object on every read, so identity says nothing — comparing the
 * current word and the advertised values is what stops a re-render per event.
 */
function samePreset(a: PermissionPresetSelect | undefined, b: PermissionPresetSelect | undefined): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (a.currentValue !== b.currentValue) return false
  if (a.options.length !== b.options.length) return false
  return a.options.every((option, i) =>
    option.value === b.options[i]?.value && option.name === b.options[i]?.name)
}

/**
 * Subscribe to the effective permission preset of one agent's session.
 * @param ctx - the context the projection service may be mounted on.
 * @param agent - whose session is read and whose events are subscribed.
 * @returns the current preset select, or `undefined` with no projection.
 */
export function usePermissionPreset(
  ctx: Context,
  agent: Agent,
): PermissionPresetSelect | undefined {
  const [preset, setPreset] = useState<PermissionPresetSelect | undefined>(
    () => readPermissionPreset(ctx, agent.session),
  )

  useEffect(() => {
    const refresh = (): void => {
      const next = readPermissionPreset(ctx, agent.session)
      setPreset(prev => samePreset(prev, next) ? prev : next)
    }
    // Re-read on subscribe as well as after every knob event: a registration
    // between the initial state and this effect, or a `/resume` swap onto a
    // session with its own fold, would otherwise keep a stale chip for life.
    refresh()
    const off = ctx.on('session/event', (session, event) => {
      if (session.id !== agent.session.id) return
      if (!PERMISSION_EVENTS.includes(event.type)) return
      refresh()
    })
    return () => { off() }
  }, [ctx, agent])

  return preset
}
