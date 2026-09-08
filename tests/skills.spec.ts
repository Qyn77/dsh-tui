/**
 * Skill rows in the `/skill ` picker: which skills a human may see, how they
 * are marked, what loses a name collision, how the picker token is found and
 * completed, and how a submitted line splits into a skill name and the user's
 * own words.
 */

import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import {
  applySkillMention,
  filterSkillRows,
  findSkill,
  parseSkillLine,
  skillMentionAt,
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

describe('picker rows', () => {
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

describe('the /skill token in the buffer', () => {
  it('opens on `/skill ` with an empty query', () => {
    expect(skillMentionAt('/skill ', 7)).toEqual({ query: '', start: 7, end: 7 })
  })

  it('reads the token being typed', () => {
    const buffer = '/skill rev'
    expect(skillMentionAt(buffer, buffer.length)).toEqual({ query: 'rev', start: 7, end: 10 })
  })

  it('reads the whole token when the caret is in the middle of it', () => {
    // Same rule the @ mention follows: completing mid-token replaces the
    // whole thing rather than leaving its tail behind.
    expect(skillMentionAt('/skill review', 9)).toEqual({ query: 'review', start: 7, end: 13 })
  })

  it('closes once a second token starts', () => {
    expect(skillMentionAt('/skill rev x', 12)).toBeUndefined()
  })

  it('closes on a doubled space', () => {
    expect(skillMentionAt('/skill  ', 8)).toBeUndefined()
  })

  it('does not follow the command onto a continuation line', () => {
    // Commands start on line 0; a backslash-Enter newline ends the token.
    expect(skillMentionAt('/skill\nx', 8)).toBeUndefined()
  })

  it('requires the anchor at position zero', () => {
    expect(skillMentionAt('x\n/skill ', 9)).toBeUndefined()
  })

  it.each([
    ['/skill', 6, 'no trailing space yet'],
    ['/skillx', 7, 'a longer word'],
    ['/skill-set', 10, 'a hyphenated word'],
    ['/Skill ', 7, 'the wrong case'],
  ])('does not open on %j (%s)', (buffer, cursor) => {
    expect(skillMentionAt(buffer, cursor)).toBeUndefined()
  })

  it('clamps a caret index from outside rather than trusting it', () => {
    expect(skillMentionAt('/skill rev', 99)?.query).toBe('rev')
  })
})

describe('completing the /skill token', () => {
  it('rewrites `/skill <token>` to the chosen row with a trailing space', () => {
    const mention = skillMentionAt('/skill rev', 10)
    if (!mention) throw new Error('expected a mention')
    expect(applySkillMention('/skill rev', mention, '/review'))
      .toEqual({ text: '/review ', cursor: 8 })
  })

  it('completes an empty query the same way', () => {
    const mention = skillMentionAt('/skill ', 7)
    if (!mention) throw new Error('expected a mention')
    expect(applySkillMention('/skill ', mention, '/review'))
      .toEqual({ text: '/review ', cursor: 8 })
  })
})

describe('filtering picker rows', () => {
  const rows: CommandMeta[] = [
    { name: '/review', description: '' },
    { name: '/refresh', description: '' },
    { name: '/changelog', description: '' },
  ]

  it('returns every row for an empty query, in input order', () => {
    expect(filterSkillRows(rows, '').map(r => r.name)).toEqual(['/review', '/refresh', '/changelog'])
  })

  it('prefix-matches case-insensitively on the bare name', () => {
    expect(filterSkillRows(rows, 'RE').map(r => r.name)).toEqual(['/review', '/refresh'])
    expect(filterSkillRows(rows, 'rev').map(r => r.name)).toEqual(['/review'])
  })

  it('does not match a substring in the middle', () => {
    expect(filterSkillRows(rows, 'view')).toEqual([])
  })

  it('returns nothing when nothing matches', () => {
    expect(filterSkillRows(rows, 'zzz')).toEqual([])
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
    // Completion happens in the picker; a submitted line runs what it names.
    expect(findSkill(catalog, 'rev')).toBeUndefined()
  })

  it('does not fold case', () => {
    expect(findSkill(catalog, 'Review')).toBeUndefined()
  })

  it('returns undefined for an empty catalog', () => {
    expect(findSkill([], 'review')).toBeUndefined()
  })
})
