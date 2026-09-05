/**
 * Skill rows in the `/` palette: which skills a human may see, how they are
 * marked, what loses a name collision, and how a submitted line splits into a
 * skill name and the user's own words.
 */

import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import {
  findSkill,
  parseSkillLine,
  skillRows,
  SKILL_GLYPH,
  userSkills,
  withoutShadowed,
} from '../src/skills.ts'
import type { CommandMeta } from '../src/commands.ts'

/** A summary with the invocation policy spelled out, since that is what is under test. */
function summary(
  name: string,
  description = `does ${name}`,
  invocation = { modelInvocable: true, userInvocable: true },
): SkillSummary {
  return { name, description, invocation, source: 'project-dsh', provider: 'filesystem' }
}

describe('invocation policy', () => {
  it('keeps a skill a human may invoke', () => {
    expect(userSkills([summary('review')]).map(s => s.name)).toEqual(['review'])
  })

  it('drops a model-only skill', () => {
    const modelOnly = summary('deep-search', 'searches', {
      modelInvocable: true,
      userInvocable: false,
    })
    expect(userSkills([modelOnly])).toEqual([])
  })

  it('keeps a user-only skill', () => {
    const userOnly = summary('changelog', 'writes one', {
      modelInvocable: false,
      userInvocable: true,
    })
    expect(userSkills([userOnly]).map(s => s.name)).toEqual(['changelog'])
  })

  it('does not resolve a model-only skill by name either', () => {
    const modelOnly = summary('deep-search', 'searches', {
      modelInvocable: true,
      userInvocable: false,
    })
    // Hiding the row but still running it would be the worse half of both.
    expect(findSkill([modelOnly], 'deep-search')).toBeUndefined()
  })
})

describe('palette rows', () => {
  it('prefixes the name with a slash and the description with the glyph', () => {
    expect(skillRows([summary('review', 'reviews a diff')])).toEqual([
      { name: '/review', description: `${SKILL_GLYPH} reviews a diff` },
    ])
  })

  it('keeps the name clean of the marker, because Tab writes it back', () => {
    const [row] = skillRows([summary('review')])
    expect(row?.name).toBe('/review')
    expect(row?.name).not.toContain(SKILL_GLYPH)
  })

  it('still marks a skill that describes itself with nothing', () => {
    expect(skillRows([summary('review', '')])).toEqual([
      { name: '/review', description: SKILL_GLYPH },
    ])
  })

  it('shows a non-English description as written', () => {
    const [row] = skillRows([summary('review', '审查一个 diff')])
    expect(row?.description).toBe(`${SKILL_GLYPH} 审查一个 diff`)
  })

  it('preserves registry order', () => {
    const rows = skillRows([summary('zebra'), summary('apple')])
    expect(rows.map(r => r.name)).toEqual(['/zebra', '/apple'])
  })

  it('omits model-only skills', () => {
    const rows = skillRows([
      summary('review'),
      summary('deep-search', 'searches', { modelInvocable: true, userInvocable: false }),
    ])
    expect(rows.map(r => r.name)).toEqual(['/review'])
  })
})

describe('precedence', () => {
  const taken: CommandMeta[] = [
    { name: '/clear', description: 'clears' },
    { name: '/compact', description: 'compacts' },
  ]

  it('drops a skill that would shadow a built-in', () => {
    const rows = skillRows([summary('clear'), summary('review')])
    expect(withoutShadowed(rows, taken).map(r => r.name)).toEqual(['/review'])
  })

  it('drops a skill that would shadow a plugin command', () => {
    const rows = skillRows([summary('compact')])
    expect(withoutShadowed(rows, taken)).toEqual([])
  })

  it('folds case when comparing', () => {
    const rows: CommandMeta[] = [{ name: '/Clear', description: 'x' }]
    expect(withoutShadowed(rows, taken)).toEqual([])
  })

  it('keeps everything when nothing is taken', () => {
    const rows = skillRows([summary('review'), summary('changelog')])
    expect(withoutShadowed(rows, []).map(r => r.name)).toEqual(['/review', '/changelog'])
  })

  it('preserves input order', () => {
    const rows = skillRows([summary('zebra'), summary('clear'), summary('apple')])
    expect(withoutShadowed(rows, taken).map(r => r.name)).toEqual(['/zebra', '/apple'])
  })
})

describe('splitting a submitted line', () => {
  it('reads a bare name', () => {
    expect(parseSkillLine('/review')).toEqual({ name: 'review', rest: '' })
  })

  it('reads the words after the name as prose', () => {
    expect(parseSkillLine('/review the auth change')).toEqual({
      name: 'review',
      rest: 'the auth change',
    })
  })

  it('does not split the prose into arguments', () => {
    // The rest is the user's prompt, not argv: quotes stay as typed.
    expect(parseSkillLine('/review "the auth change" now')?.rest).toBe('"the auth change" now')
  })

  it('does not unescape the prose', () => {
    expect(parseSkillLine(String.raw`/review a\ b`)?.rest).toBe(String.raw`a\ b`)
  })

  it('accepts a line with no leading slash', () => {
    expect(parseSkillLine('review it')).toEqual({ name: 'review', rest: 'it' })
  })

  it('trims surrounding whitespace on both halves', () => {
    expect(parseSkillLine('  /review   the diff  ')).toEqual({
      name: 'review',
      rest: 'the diff',
    })
  })

  it('accepts a kebab-case name', () => {
    expect(parseSkillLine('/write-changelog v2')).toEqual({
      name: 'write-changelog',
      rest: 'v2',
    })
  })

  it('accepts digits in a name', () => {
    expect(parseSkillLine('/oauth2-setup')?.name).toBe('oauth2-setup')
  })

  it.each([
    ['/', 'nothing but the slash'],
    ['', 'an empty line'],
    ['/Review', 'an uppercase name'],
    ['/my_skill', 'an underscore'],
    ['/my.skill', 'a dot'],
    ['/-review', 'a leading dash'],
    ['/review-', 'a trailing dash'],
    ['/re--view', 'a doubled dash'],
  ])('rejects %s (%s)', (input) => {
    // The grammar is the registry's; a name it could never hold is `unknown`
    // here rather than a wasted round-trip.
    expect(parseSkillLine(input)).toBeUndefined()
  })
})

describe('resolving a name', () => {
  const catalog = [summary('review'), summary('write-changelog')]

  it('finds an exact match', () => {
    expect(findSkill(catalog, 'review')?.name).toBe('review')
  })

  it('does not match a prefix', () => {
    // Completion happens in the palette; a submitted line runs what it names.
    expect(findSkill(catalog, 'rev')).toBeUndefined()
  })

  it('does not fold case', () => {
    expect(findSkill(catalog, 'Review')).toBeUndefined()
  })

  it('returns undefined for an empty catalog', () => {
    expect(findSkill([], 'review')).toBeUndefined()
  })
})
