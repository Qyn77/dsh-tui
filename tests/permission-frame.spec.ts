/**
 * Frame tests for the permission preset in the chrome: the StatusBar chip
 * exists only when a `permissions` projection is mounted, follows the
 * effective value through knob events, and `/status` names it. Color is not
 * asserted — chalk's level is 0 under vitest, so the red danger treatment is
 * judged in `pnpm tty-check`; what the frame pins is the word being there.
 *
 * @module @deepseek-ai/dsh-tui/tests/permission-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { paintApp } from './fake-tty.ts'

/**
 * Replace the fake registry's cut, the way a `/permission` switch would. A
 * seeded turn is what swaps the startup Banner for the live StatusBar — a
 * typed submission goes to the agent double's no-op followup and never lands
 * in the session log, so it would leave the Banner up.
 */
function setCut(painted: Awaited<ReturnType<typeof paintApp>>, value: string): void {
  const registry = painted.ctx.get('sessionProjections') as
    | { snapshot: () => unknown }
    | undefined
  expect(registry).toBeDefined()
  if (registry === undefined) return
  registry.snapshot = () => ({
    values: {
      permissions: {
        currentValue: value,
        options: [
          { value: 'read-only', name: 'Read-only' },
          { value: 'workspace-write', name: 'Workspace write' },
          { value: 'danger-full-access', name: 'Danger: full access' },
        ],
      },
    },
  })
}

describe('permission preset chip', () => {
  it('draws nothing without a projection service', async () => {
    const painted = await paintApp({ turns: 1 })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('workspace-write')
    expect(screen).not.toContain('danger-full-access')
  })

  it('shows the effective preset on the StatusBar row', async () => {
    const painted = await paintApp({ turns: 1, preset: 'workspace-write' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('workspace-write')
  })

  it('shows the danger preset verbatim — the word is its own warning', async () => {
    const painted = await paintApp({ turns: 1, preset: 'danger-full-access' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('danger-full-access')
  })

  it('follows the value when a knob event moves it', async () => {
    const painted = await paintApp({ turns: 1, preset: 'workspace-write' })
    expect(painted.screen()).toContain('workspace-write')
    setCut(painted, 'danger-full-access')
    // `/permission` appends `permission/preset` (plus the two knob events);
    // one is enough to prove the subscription re-reads.
    await painted.append('permission/preset', { preset: 'danger-full-access' })
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('danger-full-access')
  })

  it('names the preset in /status output', async () => {
    const painted = await paintApp({ preset: 'workspace-write' })
    await painted.send('/status')
    await painted.send('\r')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('permissions: workspace-write')
  })

  it('leaves /status at two lines when no projection is mounted', async () => {
    const painted = await paintApp()
    await painted.send('/status')
    await painted.send('\r')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('permissions:')
  })
})
