/**
 * Frame tests for the `/mcp add ` picker: it opens on the anchored token,
 * lists the preset catalog, filters by the typed word, fills on Tab, writes
 * through the ordinary `/mcp add` dispatch on Enter, and never claims a
 * pasted config block. The picker's rows are static, so unlike the model
 * picker there is no async round-trip to wait out; the Enter case does write
 * a patch file, so `$DSH_HOME` points at a temp directory.
 *
 * @module @qiao-qyn/dsh-tui/tests/mcp-frame.spec
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ESC, paintApp } from './fake-tty.ts'
import { PATCH_FILE } from '../src/mcp/mcp-patch.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-tui-mcp-frame-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
})

/** Type `/mcp add <token>` and let the frame settle. */
async function openPicker(
  painted: Awaited<ReturnType<typeof paintApp>>,
  token = '',
): Promise<void> {
  await painted.send(`/mcp add ${token}`)
  await painted.settle(50)
}

describe('the /mcp add picker', () => {
  it('lists the preset catalog with its descriptions', async () => {
    const painted = await paintApp()
    await openPicker(painted)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('memory')
    expect(screen).toContain('sequential-thinking')
    expect(screen).toContain('knowledge-graph memory')
    expect(screen).toContain('Enter write')
  })

  it('filters by the word being typed', async () => {
    const painted = await paintApp()
    await openPicker(painted, 'seq')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('sequential-thinking')
    expect(screen).not.toContain('knowledge-graph memory')
  })

  it('fills the line on Tab without writing', async () => {
    const painted = await paintApp()
    await openPicker(painted, 'mem')
    await painted.send('\t')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('/mcp add memory ')
    expect(screen).not.toContain('Enter write')
    expect(() => readFileSync(join(home, PATCH_FILE), 'utf8')).toThrow()
  })

  it('writes through the ordinary /mcp add dispatch on Enter', async () => {
    const painted = await paintApp()
    await openPicker(painted, 'mem')
    await painted.send('\r')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    // The command echo and the write report — the same dispatch a typed
    // `/mcp add memory` takes, connect-wait included (no tools service here,
    // so it reports the write without waiting).
    expect(screen).toContain('/mcp add memory')
    expect(screen).toContain(PATCH_FILE)
    expect(readFileSync(join(home, PATCH_FILE), 'utf8')).toContain('id: mcp-memory')
    expect(screen).not.toContain('Enter write')
  })

  it('dismisses once on Esc without losing the token', async () => {
    const painted = await paintApp()
    await openPicker(painted, 'mem')
    await painted.send(ESC)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Enter write')
    expect(screen).toContain('/mcp add mem')
  })

  it('never claims a pasted config block', async () => {
    const painted = await paintApp()
    await painted.send('/mcp add {"mcpServers": {"x": {"command": "npx"}}}')
    await painted.settle(50)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).not.toContain('Enter write')
    expect(screen).not.toContain('sequential-thinking')
  })
})
