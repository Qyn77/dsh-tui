/**
 * `/copy` at the frame level: the sequence actually reaching the terminal.
 *
 * `commands.spec.ts` can see that `/copy` returns the right sentence, and
 * `clipboard.spec.ts` can see that the sequence is the right bytes. Neither can
 * see whether those bytes were ever written — a `/copy` that reports success and
 * emits nothing passes both suites and copies nothing at all. That is what these
 * cases are for, and it is why they read `written()` rather than `screen()`:
 * OSC 52 is invisible by construction, so it is present in what was *sent* and
 * absent from what is *drawn*.
 *
 * Both halves are asserted together on purpose. A written sequence with no log
 * line is a command that looks like it did nothing; a log line with no sequence
 * is one that lied.
 * @module @deepseek-ai/dsh-tui/tests/copy-frame.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { paintApp, type Painted } from './fake-tty.ts'
import { catalog } from '../src/i18n.ts'
import { osc52 } from '../src/clipboard.ts'

const strings = catalog('en').output

/** Type a command into the prompt and submit it. Enter is its own chunk. */
async function run(app: Painted, command: string): Promise<void> {
  await app.send(command)
  await app.send('\r')
}

describe('/copy', () => {
  it('writes the newest reply to the terminal as OSC 52', async () => {
    const painted = await paintApp({ turns: 2 })
    await run(painted, '/copy')
    const written = painted.written()
    const screen = painted.screen()
    painted.unmount()

    // `seedSession` answers `answer 01`, `answer 02`; the newest is the target.
    expect(written).toContain(osc52('answer 02'))
    expect(written).not.toContain(osc52('answer 01'))
    // Present in the bytes, absent from the pixels. If this ever fails the other
    // way round, the sequence is being drawn instead of consumed.
    expect(screen).not.toContain('52;c;')
    // `answer 02` is nine bytes, and the count is reported in bytes.
    expect(screen).toContain('9 bytes')
  })

  it('takes the newest fenced block for /copy code', async () => {
    const painted = await paintApp({ turns: 1 })
    await painted.stream('here:\n\n```ts\nconst x = 1\n```\n', { turn: 2 })
    await run(painted, '/copy code')
    const written = painted.written()
    painted.unmount()

    expect(written).toContain(osc52('const x = 1'))
    // The prose around the fence is not part of a code copy.
    expect(written).not.toContain(osc52('here:'))
  })

  it('wraps the sequence for tmux when TMUX is set', async () => {
    // Only a frame test can show that the environment is consulted at dispatch
    // time rather than at import time — a module-level `multiplexerFromEnv()`
    // would pass `clipboard.spec.ts` and then send an unwrapped sequence to
    // every tmux user, which fails silently.
    vi.stubEnv('TMUX', '/tmp/tmux-501/default,1234,0')
    const painted = await paintApp({ turns: 1 })
    await run(painted, '/copy')
    const written = painted.written()
    painted.unmount()
    vi.unstubAllEnvs()

    // Not asserted by exclusion: the unwrapped sequence is a *substring* of the
    // wrapped one, because doubling the leading escape leaves the original
    // intact after it. The wrapper's own frame is what distinguishes them.
    expect(written).toContain(osc52('answer 01', { multiplexer: 'tmux' }))
  })

  it('emits nothing when there is no reply yet', async () => {
    const painted = await paintApp()
    await run(painted, '/copy')
    const written = painted.written()
    const screen = painted.screen()
    painted.unmount()

    expect(written).not.toContain('52;c;')
    expect(screen).toContain(strings.copyNothing('reply'))
  })

  it('emits nothing when the conversation has no code block', async () => {
    const painted = await paintApp({ turns: 1 })
    await run(painted, '/copy code')
    const written = painted.written()
    const screen = painted.screen()
    painted.unmount()

    expect(written).not.toContain('52;c;')
    expect(screen).toContain(strings.copyNothing('code'))
  })

  it('prints usage for an argument it does not recognise', async () => {
    const painted = await paintApp({ turns: 1 })
    await run(painted, '/copy codee')
    const written = painted.written()
    const screen = painted.screen()
    painted.unmount()

    // A typo copies nothing rather than falling back to the whole reply, which
    // the user would only discover on paste.
    expect(written).not.toContain('52;c;')
    expect(screen).toContain('/copy code')
  })

  it('leaves the frame on screen after the write', async () => {
    // Ink's writer clears its frame, emits the bytes, and re-emits the frame. The
    // failure this guards is the Ctrl-L one in reverse: a raw `stdout.write` here
    // would be harmless, but the writer being used wrong would blank the screen.
    const painted = await paintApp({ turns: 2 })
    await run(painted, '/copy')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain(catalog('en').prompt.placeholder)
    expect(screen).toContain('answer 02')
  })
})
