/**
 * Resolving a typed `/name` into a skill invocation: what counts as unknown,
 * what a load failure looks like, and the two messages an invocation is made
 * of.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderSkillContent, type SkillDefinition, type SkillSummary } from '@deepseek-ai/dsh-skill'
import { listSkills, resolveSkill, type SkillCatalog, type SkillDeps } from '../src/skill-runner.ts'

function summary(
  name: string,
  invocation = { modelInvocable: true, userInvocable: true },
): SkillSummary {
  return { name, description: `does ${name}`, invocation, source: 'project-dsh', provider: 'fs' }
}

function definition(name: string, content = `body of ${name}`): SkillDefinition {
  return { ...summary(name), content }
}

/** A registry holding the given skills, loading each one's body on demand. */
function fakeCatalog(
  skills: readonly SkillSummary[],
  overrides: Partial<SkillCatalog> = {},
): SkillCatalog {
  return {
    snapshot: () => Promise.resolve({ skills: [...skills], complete: true }),
    get: (name: string) => Promise.resolve(
      skills.some(s => s.name === name) ? definition(name) : undefined,
    ),
    ...overrides,
  }
}

function deps(skills?: SkillCatalog): SkillDeps {
  return { skills, cwd: '/work', scope: undefined }
}

describe('listing', () => {
  it('reports an empty complete listing with no registry mounted', async () => {
    expect(await listSkills(deps())).toEqual({ skills: [], complete: true })
  })

  it('passes the working directory through, so project skills are the right project’s', async () => {
    const snapshot = vi.fn(() => Promise.resolve({ skills: [], complete: true }))
    await listSkills({ ...deps(fakeCatalog([])), skills: { snapshot, get: () => Promise.resolve(undefined) } })
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/work' }))
  })

  it('passes the viewing scope when there is one', async () => {
    const scope = {}
    const snapshot = vi.fn(() => Promise.resolve({ skills: [], complete: true }))
    await listSkills({ skills: { snapshot, get: () => Promise.resolve(undefined) }, cwd: '/w', scope })
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ scope }))
  })

  it('omits scope entirely rather than passing undefined', async () => {
    const snapshot = vi.fn(() => Promise.resolve({ skills: [], complete: true }))
    await listSkills({ skills: { snapshot, get: () => Promise.resolve(undefined) }, cwd: '/w' })
    const [passed] = snapshot.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(passed).not.toHaveProperty('scope')
  })

  it('reports incompleteness rather than hiding it', async () => {
    const catalog = fakeCatalog([summary('review')], {
      snapshot: () => Promise.resolve({ skills: [summary('review')], complete: false }),
    })
    expect(await listSkills(deps(catalog))).toEqual({ skills: [summary('review')], complete: false })
  })

  it('treats a throwing registry as empty and incomplete, not as a crash', async () => {
    const catalog = fakeCatalog([], { snapshot: () => Promise.reject(new Error('provider down')) })
    // A provider failing to start is not a reason for the prompt to stop working.
    expect(await listSkills(deps(catalog))).toEqual({ skills: [], complete: false })
  })
})

describe('unknown names', () => {
  it.each([
    ['no registry is mounted', undefined, '/review'],
    ['the name is outside the skill grammar', fakeCatalog([summary('review')]), '/Review'],
    ['no provider offers the name', fakeCatalog([summary('review')]), '/audit'],
    [
      'the skill is model-only',
      fakeCatalog([summary('deep-search', { modelInvocable: true, userInvocable: false })]),
      '/deep-search',
    ],
  ])('is unknown when %s', async (_why, catalog, line) => {
    expect(await resolveSkill(line, deps(catalog))).toEqual({ kind: 'unknown' })
  })

  it('does not load a body for a name it will not run', async () => {
    const get = vi.fn(() => Promise.resolve(undefined))
    const catalog = fakeCatalog([summary('deep-search', { modelInvocable: true, userInvocable: false })], { get })
    await resolveSkill('/deep-search', deps(catalog))
    expect(get).not.toHaveBeenCalled()
  })
})

describe('load failures', () => {
  it('reports a listed skill whose body will not load', async () => {
    const catalog = fakeCatalog([summary('review')], { get: () => Promise.resolve(undefined) })
    expect(await resolveSkill('/review', deps(catalog))).toEqual({ kind: 'failed', name: 'review' })
  })

  it('reports a provider that throws while loading', async () => {
    const catalog = fakeCatalog([summary('review')], { get: () => Promise.reject(new Error('EACCES')) })
    expect(await resolveSkill('/review', deps(catalog))).toEqual({ kind: 'failed', name: 'review' })
  })

  it('does not report a load failure as unknown', async () => {
    // The user did name something real; telling them it does not exist would
    // send them looking for a typo instead of at the file.
    const catalog = fakeCatalog([summary('review')], { get: () => Promise.resolve(undefined) })
    const outcome = await resolveSkill('/review', deps(catalog))
    expect(outcome.kind).not.toBe('unknown')
  })
})

describe('an invocation', () => {
  const catalog = fakeCatalog([summary('review')])

  it('is two messages', async () => {
    const outcome = await resolveSkill('/review the auth change', deps(catalog))
    expect(outcome.kind).toBe('invoked')
    if (outcome.kind !== 'invoked') return
    expect(outcome.context).toBeDefined()
    expect(outcome.prompt).toBeDefined()
  })

  it('carries the skill body verbatim from renderSkillContent', async () => {
    const outcome = await resolveSkill('/review', deps(catalog))
    if (outcome.kind !== 'invoked') throw new Error('expected an invocation')
    const [block] = outcome.context.content
    expect(block).toEqual({ type: 'text', text: renderSkillContent(definition('review')) })
  })

  it('marks the body with the skill-invocation source, so the row can be labelled from metadata', async () => {
    const outcome = await resolveSkill('/review', deps(catalog))
    if (outcome.kind !== 'invoked') throw new Error('expected an invocation')
    expect(outcome.context.source).toEqual({
      kind: 'skill-invocation',
      name: 'review',
      form: 'instructions',
    })
  })

  it('sends the user’s words as an ordinary user message', async () => {
    const outcome = await resolveSkill('/review the auth change', deps(catalog))
    if (outcome.kind !== 'invoked') throw new Error('expected an invocation')
    expect(outcome.prompt.source).toEqual({ kind: 'user' })
    expect(outcome.prompt.content).toEqual([{ type: 'text', text: 'the auth change' }])
  })

  it('keeps the user’s words out of the skill body', async () => {
    const outcome = await resolveSkill('/review the auth change', deps(catalog))
    if (outcome.kind !== 'invoked') throw new Error('expected an invocation')
    const body = outcome.context.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    expect(body).not.toContain('the auth change')
  })

  it('falls back to the typed line when there are no words, so the message can wake the driver', async () => {
    const outcome = await resolveSkill('/review', deps(catalog))
    if (outcome.kind !== 'invoked') throw new Error('expected an invocation')
    expect(outcome.prompt.content).toEqual([{ type: 'text', text: '/review' }])
  })

  it('names the skill it resolved', async () => {
    const outcome = await resolveSkill('  /review  now  ', deps(catalog))
    if (outcome.kind !== 'invoked') throw new Error('expected an invocation')
    expect(outcome.name).toBe('review')
    expect(outcome.prompt.content).toEqual([{ type: 'text', text: 'now' }])
  })

  it('re-reads the catalog on invocation rather than trusting the palette', async () => {
    const snapshot = vi.fn(() => Promise.resolve({ skills: [summary('review')], complete: true }))
    await resolveSkill('/review', deps(fakeCatalog([summary('review')], { snapshot })))
    // A skill is a file another process may have just rewritten.
    expect(snapshot).toHaveBeenCalledTimes(1)
  })
})
