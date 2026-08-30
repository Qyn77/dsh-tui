/**
 * `useRegistryCommands` — the hook that keeps the `/` palette in step with the
 * plugin command registry. Like `useRunningClock`, its behaviour is a sequence
 * no single frame can show: that a command registered after mount appears, that
 * one whose plugin was disposed disappears, and that the subscription is torn
 * down so a late `commands/change` cannot write into an unmounted tree.
 *
 * The registry is a stand-in rather than a real `CommandRuntime`: the hook only
 * reads `list` and listens for `commands/change`, and a real runtime would drag
 * in the whole plugin-registration path to assert a mapping of two fields.
 * @module @deepseek-ai/dsh-tui/tests/registry-commands.spec
 */

import { describe, expect, it } from 'vitest'
import React from 'react'
import { render, Text } from 'ink'
import { Context } from '@deepseek-ai/cordis'
import { useRegistryCommands } from '../src/hooks/useRegistryCommands.ts'
import type { CommandMeta } from '../src/commands.ts'
import { fakeStdout } from './fake-tty.ts'

const { act } = React

/** A mutable registry stand-in, plus the context it is provided on. */
interface Stand {
  ctx: Context
  /** Replace what `list` returns; does not announce the change. */
  setCommands: (names: readonly string[]) => void
  /** Announce a registry change the way `CommandRuntime` does. */
  announce: () => Promise<void>
}

function makeStand(initial: readonly string[]): Stand {
  const ctx = new Context()
  let names = initial
  ctx.provide('commands', {
    list: () => names.map(name => ({ name, description: `does ${name}` })),
  } as never)
  return {
    ctx,
    setCommands: (next) => { names = next },
    announce: async () => {
      await act(async () => {
        ctx.emit('commands/change')
        await Promise.resolve()
      })
    },
  }
}

/** A mounted probe over the hook. */
interface Probe {
  /** The names the hook currently reports. */
  names: () => string[]
  /** The array identity the hook currently returns. */
  rows: () => readonly CommandMeta[]
  unmount: () => void
}

async function mount(ctx: Context): Promise<Probe> {
  let latest: readonly CommandMeta[] = []
  const Harness: React.FC = () => {
    latest = useRegistryCommands(ctx, { id: 'tui-1' } as never)
    return React.createElement(Text, null, 'probe')
  }
  const instance = render(React.createElement(Harness), {
    stdout: fakeStdout(80, 10) as never,
    patchConsole: false,
    debug: true,
  })
  await act(async () => { await Promise.resolve() })
  return {
    names: () => latest.map(c => c.name),
    rows: () => latest,
    unmount: () => { instance.unmount() },
  }
}

describe('useRegistryCommands', () => {
  it('reports the registry contents at mount', async () => {
    const stand = makeStand(['compact', 'goal'])
    const probe = await mount(stand.ctx)
    expect(probe.names()).toEqual(['/compact', '/goal'])
    probe.unmount()
  })

  it('reports nothing when no registry is mounted', async () => {
    // A leaf that mounts no command plugin still gets a working palette; the
    // built-in table is simply the whole surface.
    const probe = await mount(new Context())
    expect(probe.names()).toEqual([])
    probe.unmount()
  })

  it('picks up a command registered after mount', async () => {
    const stand = makeStand(['compact'])
    const probe = await mount(stand.ctx)
    stand.setCommands(['compact', 'feedback'])
    await stand.announce()
    expect(probe.names()).toEqual(['/compact', '/feedback'])
    probe.unmount()
  })

  it('drops a command whose registration was disposed', async () => {
    // `register` returns a disposer, so a palette that read once at mount would
    // keep offering a command that can no longer run.
    const stand = makeStand(['compact', 'goal'])
    const probe = await mount(stand.ctx)
    stand.setCommands(['compact'])
    await stand.announce()
    expect(probe.names()).toEqual(['/compact'])
    probe.unmount()
  })

  it('keeps the same array when a change leaves the list identical', async () => {
    // `registryCommands` builds a fresh array per call, so identity is the only
    // evidence that the hook compared contents instead of writing state
    // unconditionally. Writing it unconditionally is not a wasted render but a
    // hang: the first version of this hook re-read inside its own effect, and a
    // caller whose `agent` identity changed per render drove it into
    // "Maximum update depth exceeded" rather than a slow palette.
    const stand = makeStand(['compact'])
    const probe = await mount(stand.ctx)
    const before = probe.rows()
    await stand.announce()
    expect(probe.rows()).toBe(before)
    probe.unmount()
  })

  it('stops listening once unmounted', async () => {
    const stand = makeStand(['compact'])
    const probe = await mount(stand.ctx)
    probe.unmount()
    stand.setCommands(['compact', 'goal'])
    // The assertion is the absence of a React "update on an unmounted
    // component" warning as much as the stale value: nothing should have
    // re-read the registry after the disposer ran.
    await stand.announce()
    expect(probe.names()).toEqual(['/compact'])
  })
})
