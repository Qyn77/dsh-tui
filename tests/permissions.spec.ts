/**
 * Reading the effective permission preset off the optional projection
 * service: absence stays absent, a malformed value degrades to absent, and
 * the one table key that names the open-sandbox/never-ask stance earns the
 * danger treatment.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DANGER_PRESET, type PermissionPresetSelect } from '../src/types.ts'
import { PERMISSION_EVENTS, isDangerPreset, readPermissionPreset } from '../src/permissions.ts'

/** A select with the dsh-base table, current at `value`. */
function select(value: string): PermissionPresetSelect {
  return {
    currentValue: value,
    options: [
      { value: 'read-only', name: 'Read-only' },
      { value: 'workspace-write', name: 'Workspace write' },
      { value: 'danger-full-access', name: 'Danger: full access' },
    ],
  }
}

/** A context carrying a fake projection registry. */
function contextWith(snapshot: (session: unknown) => unknown): Context {
  const ctx = new Context()
  ctx.provide('sessionProjections', { snapshot } as never)
  return ctx
}

describe('readPermissionPreset', () => {
  it('is undefined without a projection service', () => {
    expect(readPermissionPreset(new Context(), {})).toBeUndefined()
  })

  it('is undefined when the snapshot carries no permissions unit', () => {
    const ctx = contextWith(() => ({ values: {} }))
    expect(readPermissionPreset(ctx, {})).toBeUndefined()
  })

  it('reads the current value and advertised options', () => {
    const ctx = contextWith(() => ({ values: { permissions: select('workspace-write') } }))
    expect(readPermissionPreset(ctx, {})?.currentValue).toBe('workspace-write')
    expect(readPermissionPreset(ctx, {})?.options).toHaveLength(3)
  })

  it('passes the exact session through to the registry', () => {
    const snapshot = vi.fn(() => ({ values: { permissions: select('read-only') } }))
    const ctx = contextWith(snapshot)
    const session = { id: 'tui-x' }
    readPermissionPreset(ctx, session)
    expect(snapshot).toHaveBeenCalledWith(session)
  })

  it.each([
    ['currentValue is not a string', { currentValue: 42, options: [] }],
    ['options is missing', { currentValue: 'read-only' }],
    ['options is not an array', { currentValue: 'read-only', options: {} }],
    ['an option lacks a string value', { currentValue: 'read-only', options: [{ name: 'x' }] }],
    ['an option lacks a string name', { currentValue: 'read-only', options: [{ value: 'read-only' }] }],
    ['the payload is null', null],
  ])('is undefined when %s', (_label, payload) => {
    const ctx = contextWith(() => ({ values: { permissions: payload } }))
    expect(readPermissionPreset(ctx, {})).toBeUndefined()
  })

  it('degrades to undefined when the registry throws', () => {
    const ctx = contextWith(() => { throw new Error('schema rejected') })
    expect(readPermissionPreset(ctx, {})).toBeUndefined()
  })
})

describe('isDangerPreset', () => {
  it('flags the dsh-base danger key and nothing else', () => {
    expect(isDangerPreset(select(DANGER_PRESET))).toBe(true)
    expect(isDangerPreset(select('workspace-write'))).toBe(false)
    expect(isDangerPreset(select('read-only'))).toBe(false)
    expect(isDangerPreset(select('custom'))).toBe(false)
  })
})

describe('PERMISSION_EVENTS', () => {
  it('lists the three whole-value knob events the projection folds', () => {
    expect([...PERMISSION_EVENTS].sort()).toEqual([
      'approval/policy',
      'permission/preset',
      'sandbox/mode',
    ])
  })
})
