/**
 * `planResume` — which stored session a run continues, and what it says when it
 * cannot continue one.
 *
 * Every case here is a failure path that must not be an error. The registry's
 * `resume()` rejects on a session it cannot load, and a rejected boot means no
 * terminal at all; so a bad request has to degrade into a fresh session with a
 * stated reason, and these tests pin that the reason exists and is specific
 * enough to act on.
 *
 * The persistence service is a stand-in: the resolver reads exactly `list()`,
 * and a real backend would drag a filesystem into a test about sorting by
 * `createdAt`.
 * @module @deepseek-ai/dsh-tui/tests/resume.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, type SessionHeader } from '@deepseek-ai/dsh-session'
import { LATEST, planResume, requestFromEnv } from '../src/resume.ts'

function header(id: string, createdAt: number): SessionHeader {
  return { version: 1, id: SessionId(id), createdAt }
}

/** A context with a persistence stand-in that lists `headers`. */
function withStore(headers: readonly SessionHeader[]): Context {
  const ctx = new Context()
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([...headers]),
  } as never)
  return ctx
}

describe('planResume', () => {
  it('starts fresh, silently, when nothing was requested', async () => {
    // The default path: no notice, because nothing went wrong.
    expect(await planResume(withStore([]), undefined)).toEqual({ kind: 'fresh' })
  })

  it('resumes the newest stored session for "last"', async () => {
    // Listing order is the backend's business, so the newest is chosen by the
    // durable `createdAt` rather than by position.
    const ctx = withStore([
      header('tui-old', 1_000),
      header('tui-newest', 3_000),
      header('tui-middle', 2_000),
    ])
    expect(await planResume(ctx, LATEST)).toEqual({ kind: 'resume', id: 'tui-newest' })
  })

  it('resumes an explicitly named session', async () => {
    const ctx = withStore([header('tui-a', 1_000), header('tui-b', 2_000)])
    expect(await planResume(ctx, 'tui-a')).toEqual({ kind: 'resume', id: 'tui-a' })
  })

  it('resumes from the abbreviated id that /sessions prints', async () => {
    // `/sessions` shows twelve characters, because a full `tui-<uuid>` fills
    // half an 80-column row. Resume has to accept what the listing shows.
    const ctx = withStore([header('tui-9f3c1a2b-0000-4000-8000-000000000001', 1_000)])
    expect(await planResume(ctx, 'tui-9f3c1a2b')).toEqual({
      kind: 'resume',
      id: 'tui-9f3c1a2b-0000-4000-8000-000000000001',
    })
  })

  it('refuses an abbreviation that fits two sessions, naming the count', async () => {
    // Picking either one silently would resume the wrong history, which the
    // user only discovers after reading a transcript that is not theirs.
    const ctx = withStore([
      header('tui-9f3c1a2b-0000-4000-8000-000000000001', 1_000),
      header('tui-9f3c1a2b-0000-4000-8000-000000000002', 2_000),
    ])
    const plan = await planResume(ctx, 'tui-9f3c')
    expect(plan.kind).toBe('fresh')
    expect(plan.kind === 'fresh' ? plan.notice : undefined).toContain('2')
  })

  it('reads a full id as itself, never as a prefix of a longer one', async () => {
    const ctx = withStore([header('tui-a', 1_000), header('tui-ab', 2_000)])
    expect(await planResume(ctx, 'tui-a')).toEqual({ kind: 'resume', id: 'tui-a' })
  })

  it('explains an id that is not in the store, and starts fresh', async () => {
    // Handing the id to `resume()` instead would reject the boot: a mistyped id
    // would cost the user their terminal rather than their history.
    const plan = await planResume(withStore([header('tui-a', 1_000)]), 'tui-typo')
    expect(plan.kind).toBe('fresh')
    expect(plan.kind === 'fresh' ? plan.notice : undefined).toContain('tui-typo')
  })

  it('explains an empty store on the first ever run', async () => {
    const plan = await planResume(withStore([]), LATEST)
    expect(plan.kind).toBe('fresh')
    expect(plan.kind === 'fresh' ? plan.notice : undefined).toContain('no stored sessions')
  })

  it('explains a bundle that mounts no persistence at all', async () => {
    // A leaf profile can legitimately run with nothing durable behind it. The
    // request is then unanswerable rather than wrong, and saying which is which
    // is the difference between "your history is gone" and "you never had any".
    const plan = await planResume(new Context(), LATEST)
    expect(plan.kind).toBe('fresh')
    expect(plan.kind === 'fresh' ? plan.notice : undefined).toContain('no session persistence')
  })
})

describe('requestFromEnv', () => {
  it('reads a request from DSH_TUI_RESUME', () => {
    expect(requestFromEnv({ DSH_TUI_RESUME: 'last' })).toBe('last')
    expect(requestFromEnv({ DSH_TUI_RESUME: '  tui-a  ' })).toBe('tui-a')
  })

  it('treats unset and blank alike', () => {
    // An exported-but-empty variable is how a shell leaves a cleared setting,
    // and it must not read as a request for a session named "".
    expect(requestFromEnv({})).toBeUndefined()
    expect(requestFromEnv({ DSH_TUI_RESUME: '   ' })).toBeUndefined()
  })
})
