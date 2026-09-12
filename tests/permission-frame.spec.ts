/**
 * Frame tests for the permission preset in the chrome: the StatusBar chip
 * exists only when a `permissions` projection is mounted, follows the
 * effective value through knob events, and `/status` names it. Color is not
 * asserted — chalk's level is 0 under vitest, so the red danger treatment is
 * judged in `pnpm tty-check`; what the frame pins is the word being there.
 *
 * @module @qiao-qyn/dsh-tui/tests/permission-frame.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { ESC, paintApp } from './fake-tty.ts'

/** A plugin `/permission` command that records the raw line it received. */
function permissionRegistry(run: (raw: string) => void) {
  return [{
    name: 'permission',
    description: 'switch the permission preset',
    handler: (raw: string) => {
      run(raw)
      return `switched: ${raw}`
    },
  }]
}

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

describe('the /permission picker', () => {
  it('opens on `/permission ` and lists every advertised preset with the live one marked', async () => {
    const painted = await paintApp({ preset: 'workspace-write' })
    await painted.send('/permission ')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('read-only')
    expect(screen).toContain('workspace-write')
    expect(screen).toContain('danger-full-access')
    // The projection's display names are the descriptions; the current value
    // carries the check mark.
    expect(screen).toContain('✓ Workspace write')
    expect(screen).not.toContain('✓ Read-only')
    expect(screen).toContain('Enter switch')
  })

  it('filters by the preset token being typed', async () => {
    const painted = await paintApp({ preset: 'workspace-write' })
    await painted.send('/permission dan')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('danger-full-access')
    expect(screen).not.toContain('workspace-write')
    expect(screen).not.toContain('read-only')
  })

  it('stays closed when no projection advertises presets', async () => {
    const painted = await paintApp({
      registryCommands: permissionRegistry(() => {}),
    })
    await painted.send('/permission ')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Enter switch')
    expect(screen).not.toContain('Danger: full access')
  })

  it('submits /permission <value> to the plugin command on Enter', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      preset: 'workspace-write',
      registryCommands: permissionRegistry(ran),
    })
    await painted.send('/permission dan')
    await painted.send('\r')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    expect(ran).toHaveBeenCalledTimes(1)
    expect(ran).toHaveBeenCalledWith('/permission danger-full-access')
    // The echo and the fake plugin's output both reach the log.
    expect(screen).toContain('/permission danger-full-access')
    expect(screen).toContain('switched: /permission danger-full-access')
  })

  it('fills the line on Tab without sending, and Enter then dispatches it', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      preset: 'workspace-write',
      registryCommands: permissionRegistry(ran),
    })
    await painted.send('/permission dan')
    await painted.send('\t')
    const filled = painted.screen()
    // Trailing space closes the picker; nothing has run yet.
    expect(filled).toContain('/permission danger-full-access ')
    expect(filled).not.toContain('Enter switch')
    expect(ran).not.toHaveBeenCalled()
    await painted.send('\r')
    await painted.settle(50)
    painted.unmount()

    expect(ran).toHaveBeenCalledTimes(1)
    expect(ran).toHaveBeenCalledWith('/permission danger-full-access')
  })

  it('dismisses once on Esc without losing the token', async () => {
    const painted = await paintApp({ preset: 'workspace-write' })
    await painted.send('/permission dan')
    await painted.send(ESC)
    const dismissed = painted.screen()
    expect(dismissed).not.toContain('Enter switch')
    expect(dismissed).toContain('/permission dan')
    painted.unmount()
  })

  it('opens when bare /permission is chosen from the / palette on Enter', async () => {
    const painted = await paintApp({
      preset: 'workspace-write',
      registryCommands: permissionRegistry(() => {}),
    })
    await painted.send('/permission')
    await painted.send('\r')
    const screen = painted.screen()
    painted.unmount()

    // The special case completes to `/permission ` instead of dispatching the
    // bare command, so the plugin's own usage answer never runs.
    expect(screen).toContain('/permission ')
    expect(screen).toContain('Enter switch')
  })

  it('does not intercept bare /permission Enter without advertised presets', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      registryCommands: permissionRegistry(ran),
    })
    await painted.send('/permission')
    await painted.send('\r')
    await painted.settle(50)
    painted.unmount()

    // No projection: the bare line belongs to the plugin, which answers it.
    expect(ran).toHaveBeenCalledWith('/permission')
  })
})

describe('cycling presets from the empty prompt', () => {
  it('Tab submits /permission <next> — the same line the picker would send', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      preset: 'workspace-write',
      registryCommands: permissionRegistry(ran),
    })
    await painted.send('\t')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    // read-only → workspace-write → danger-full-access, forward.
    expect(ran).toHaveBeenCalledTimes(1)
    expect(ran).toHaveBeenCalledWith('/permission danger-full-access')
    // The switch keeps its audit trail: command echo plus plugin output.
    expect(screen).toContain('/permission danger-full-access')
    expect(screen).toContain('switched: /permission danger-full-access')
  })

  it('Shift+Tab steps backward through the table', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      preset: 'workspace-write',
      registryCommands: permissionRegistry(ran),
    })
    await painted.send(`${ESC}[Z`)
    await painted.settle(50)
    painted.unmount()

    expect(ran).toHaveBeenCalledWith('/permission read-only')
  })

  it('wraps around at both ends of the table', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      preset: 'danger-full-access',
      registryCommands: permissionRegistry(ran),
    })
    await painted.send('\t')
    await painted.settle(50)
    painted.unmount()

    expect(ran).toHaveBeenCalledWith('/permission read-only')
  })

  it('does not fire while the buffer holds text or a list is open', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      preset: 'workspace-write',
      registryCommands: permissionRegistry(ran),
    })
    // Text in the buffer: Tab is an editing key, not a shortcut.
    await painted.send('hi')
    await painted.send('\t')
    // Ctrl-C abandons the line, the way a user would.
    await painted.send('\x03')
    // The permission picker open: Tab completes, it does not cycle.
    await painted.send('/permission ')
    await painted.send('\t')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    expect(ran).not.toHaveBeenCalled()
    expect(screen).toContain('/permission read-only ')
  })

  it('leaves Tab alone when no projection advertises presets', async () => {
    const ran = vi.fn()
    const painted = await paintApp({
      registryCommands: permissionRegistry(ran),
    })
    await painted.send('\t')
    await painted.settle(50)
    painted.unmount()

    expect(ran).not.toHaveBeenCalled()
  })
})
