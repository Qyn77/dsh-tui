/**
 * `!` shell escapes at the frame level: a real subprocess, painted into a real
 * frame, read back off a fake TTY.
 *
 * The parsing rules are pinned in `shell.spec.ts` and the spawn semantics in
 * `shell-runner.spec.ts`. Neither can see whether the App is wired to them at
 * all — a `!` branch that never calls the runner passes both suites. What is
 * only observable here is that typing `!` at the prompt produces a row.
 *
 * **Every case that changes the working directory must restore it.** A `chdir`
 * is process-global, and a spec that leaves the process somewhere else poisons
 * every later file in the run. That is the one way this suite can break code it
 * is not testing, so the restore is an `afterEach`, not a line at the end of a
 * case.
 * @module @deepseek-ai/dsh-tui/tests/shell-frame.spec
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'
import { paintApp } from './fake-tty.ts'
import { catalog } from '../src/i18n.ts'
import { PREVIEW_MAX_LINES } from '../src/message-layout.ts'

const origin = process.cwd()
afterEach(() => { process.chdir(origin) })

/**
 * Type a line, press Enter, and wait for the row it produces.
 *
 * Ink needs the text and the Enter as separate chunks. The wait polls for
 * `marker` rather than sleeping a fixed budget: a subprocess outlives the
 * default settle, but a fixed sleep long enough for the slowest case would make
 * this file take twenty seconds to assert eleven frames. The marker defaults to
 * the command itself, which is unambiguous *after* Enter because the prompt
 * buffer has cleared by then.
 */
async function run(
  painted: Awaited<ReturnType<typeof paintApp>>,
  line: string,
  marker = line.replace(/^!+/, ''),
): Promise<void> {
  await painted.send(line)
  await painted.send('\r')
  for (let waited = 0; waited < 3_000; waited += 40) {
    if (painted.screen().includes(marker)) return
    await painted.settle(40)
  }
}

describe('! shell escape', () => {
  it('runs the command and paints its output', async () => {
    const painted = await paintApp()
    await run(painted, '!node -e "process.stdout.write(\'sentinel-out\')"')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('sentinel-out')
    // The echoed command line carries the `!` sigil, without it being retyped
    // into the prompt buffer.
    expect(screen).toContain('!')
  })

  it('reports a non-zero exit on the status row', async () => {
    const painted = await paintApp()
    await run(painted, '!node -e "process.exit(7)"')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain(catalog('en').shell.exit(7))
  })

  it('says nothing extra when the command simply worked', async () => {
    const painted = await paintApp()
    await run(painted, '!node -e "process.stdout.write(\'ok\')"')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('ok')
    expect(screen).not.toContain(catalog('en').shell.exit(0))
    expect(screen).not.toContain(catalog('en').shell.injected)
  })

  it('keeps `!` output away from the model but sends `!!` output to it', async () => {
    const viewOnly = vi.fn()
    const first = await paintApp({ inject: viewOnly })
    await run(first, '!node -e "process.stdout.write(\'quiet\')"')
    first.unmount()
    expect(viewOnly).not.toHaveBeenCalled()

    const injected = vi.fn()
    const second = await paintApp({ inject: injected })
    await run(second, '!!node -e "process.stdout.write(\'loud\')"')
    const screen = second.screen()
    second.unmount()

    expect(injected).toHaveBeenCalledOnce()
    expect(JSON.stringify(injected.mock.calls[0])).toContain('loud')
    expect(screen).toContain(catalog('en').shell.injected)
  })

  it('shows usage for a bare sigil rather than running an empty shell', async () => {
    const painted = await paintApp()
    await run(painted, '!', catalog('en').shell.usage)
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain(catalog('en').shell.usage)
  })

  it('previews a long output and says how many lines it withheld', async () => {
    // A command that prints more than the screen can hold used to be painted
    // in full, which pushed the prompt — and everything above it — off the
    // top. The cap is what keeps a `!cat` of a large file survivable.
    const painted = await paintApp()
    await run(
      painted,
      '!node -e "for(let i=1;i<=30;i+=1)process.stdout.write(\'row-\'+i+String.fromCharCode(10))"',
      'row-1',
    )
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('row-1')
    expect(screen).toContain(`row-${PREVIEW_MAX_LINES}`)
    // The line just past the cap is withheld, and the frame says so in words
    // rather than simply dropping it.
    expect(screen).not.toContain(`row-${PREVIEW_MAX_LINES + 1}`)
    expect(screen).toContain(catalog('en').entries.hiddenLines(30 - PREVIEW_MAX_LINES))
  })

  it('translates the status row but never the command output', async () => {
    const painted = await paintApp({ lang: 'zh' })
    await run(painted, '!node -e "process.stdout.write(\'raw-bytes\');process.exit(4)"')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain(catalog('zh').shell.exit(4))
    expect(screen).not.toContain(catalog('en').shell.exit(4))
    // The program's own output is the program's, in whatever language it emits.
    expect(screen).toContain('raw-bytes')
  })
})

describe('!cd', () => {
  it('moves the working directory and keeps it moved', async () => {
    const target = realpathSync(tmpdir())
    const painted = await paintApp()
    await run(painted, `!cd ${target}`)
    expect(realpathSync(process.cwd())).toBe(target)

    // The next command inherits it — the whole point of owning a cwd rather
    // than passing one per spawn.
    await run(painted, '!node -e "process.stdout.write(process.cwd())"')
    const screen = painted.screen()
    painted.unmount()
    expect(screen).toContain(target)
  })

  it('always tells the model, even when written as `!` rather than `!!`', async () => {
    // A cwd change silently redefines every relative path the model resolves
    // afterwards; it has no other way to learn about it.
    const injected = vi.fn()
    const painted = await paintApp({ inject: injected })
    await run(painted, `!cd ${realpathSync(tmpdir())}`)
    painted.unmount()

    expect(injected).toHaveBeenCalledOnce()
  })

  it('reports a directory that is not there and does not move', async () => {
    const painted = await paintApp()
    await run(painted, '!cd ./definitely-not-a-directory-here')
    const screen = painted.screen()
    painted.unmount()

    expect(process.cwd()).toBe(origin)
    expect(screen).toContain(catalog('en').shell.exit(1))
  })

  it('goes back with `cd -`', async () => {
    const target = realpathSync(tmpdir())
    const painted = await paintApp()
    await run(painted, `!cd ${target}`)
    await run(painted, '!cd -')
    painted.unmount()

    expect(process.cwd()).toBe(origin)
  })

  it('has nowhere to go for the first `cd -` of a session', async () => {
    const painted = await paintApp()
    await run(painted, '!cd -')
    const screen = painted.screen()
    painted.unmount()

    expect(process.cwd()).toBe(origin)
    expect(screen).toContain(catalog('en').shell.cdUnresolved)
  })
})
