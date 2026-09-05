/**
 * User-invocable skills, as `/` palette rows and as a name to resolve.
 *
 * A skill is not a command, and the difference is the whole reason this module
 * exists separately from `commands.ts`. Every other `/` row either changes view
 * state or calls a plugin handler that hands back text; a skill row **starts a
 * turn** — it injects instructions and the model runs. That costs tokens and
 * takes time, so the palette marks skill rows rather than blending them in.
 *
 * `@deepseek-ai/dsh-skill` owns discovery and precedence *within* the registry.
 * This module owns only the part the registry cannot know: how skills rank
 * against the TUI's own commands, which skills a human may invoke at all, and
 * what a row looks like. Everything here is pure — reading `ctx.skills` and
 * building messages is `skill-runner.ts`.
 * @module @deepseek-ai/dsh-tui/skills
 */

import { isSkillName, isUserInvocable, type SkillSummary } from '@deepseek-ai/dsh-skill'
import type { CommandMeta } from './commands.ts'

/**
 * Marks a palette row as a skill. Prefixes the description rather than the
 * name because the name is what Tab writes back into the buffer — a glyph
 * there would be typed into the prompt and then have to be deleted.
 *
 * `◆` is not in the message-list glyph vocabulary (`message-layout.ts`) on
 * purpose: those glyphs label rows in the transcript, and this one labels a
 * row in a floating list that never reaches the log.
 */
export const SKILL_GLYPH = '◆'

/**
 * Filter a catalog to the skills a human may invoke.
 *
 * The policy is the provider's, expressed per skill as
 * `invocation.userInvocable`, and this surface does not get to overrule it: a
 * model-only skill is absent from the palette *and* unresolvable by name, so
 * typing it is `unknown` rather than a silent success. Hiding a row while
 * still running it would be the worse half of both behaviours.
 * @param skills - every winning summary the registry reported.
 * @returns those whose invocation policy permits a human to run them.
 */
export function userSkills(skills: readonly SkillSummary[]): SkillSummary[] {
  return skills.filter(s => isUserInvocable(s))
}

/**
 * Map user-invocable skills into palette rows.
 *
 * The description is the skill's own, prefixed with {@link SKILL_GLYPH} and
 * shown as written — same rule `registryCommands` follows for plugin
 * descriptors, and for the same reason: the wording belongs to whoever wrote
 * the skill, including its language. A skill that describes itself with an
 * empty string still gets the glyph, so an unhelpful row is still a *marked*
 * row.
 * @param skills - summaries, typically straight from `ctx.skills.list()`.
 * @returns one row per user-invocable skill, registry order preserved.
 */
export function skillRows(skills: readonly SkillSummary[]): CommandMeta[] {
  return userSkills(skills).map(s => ({
    name: `/${s.name}`,
    description: s.description === '' ? SKILL_GLYPH : `${SKILL_GLYPH} ${s.description}`,
  }))
}

/**
 * Drop skill rows whose name is already taken by a command.
 *
 * Precedence is built-ins, then the plugin registry, then skills. `allCommands`
 * already gives built-ins the win for a stated reason — advertising behaviour
 * that cannot run is worse than omitting the row — and skills lose to both for
 * an additional one: a skill is the only layer a user creates by dropping a
 * file into a directory. The layer that is easiest to add by accident should
 * be the layer that cannot shadow anything.
 *
 * Comparison is case-insensitive, matching `allCommands`. Skill names are
 * kebab-case by grammar, so the fold only ever matters against the other side.
 * @param skills - candidate skill rows.
 * @param taken - names already claimed, each including the leading `/`.
 * @returns the rows that survive, input order preserved.
 */
export function withoutShadowed(
  skills: readonly CommandMeta[],
  taken: readonly CommandMeta[],
): CommandMeta[] {
  const claimed = new Set(taken.map(c => c.name.toLowerCase()))
  return skills.filter(s => !claimed.has(s.name.toLowerCase()))
}

/**
 * Split a `/`-prefixed input line into a skill name and the words after it.
 *
 * The rest is the user's own prompt for this invocation and travels as a
 * plain user message, never inside the skill body — so it is returned raw and
 * merely trimmed, with no unescaping, no quote handling, and no argument
 * splitting. It is prose, not `argv`.
 *
 * A line whose name is not a valid skill name returns `undefined` instead of
 * a name that could never match, so the caller can fall through to `unknown`
 * without a registry round-trip. The grammar is `isSkillName`'s, not a copy of
 * it — a second definition of "valid skill name" would drift from the one the
 * providers actually enforce.
 * @param line - the raw input, with or without the leading `/`.
 * @returns the bare skill name and the trailing prose, or `undefined`.
 */
export function parseSkillLine(line: string): { name: string; rest: string } | undefined {
  const trimmed = line.trim()
  const body = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const space = body.search(/\s/)
  const name = space === -1 ? body : body.slice(0, space)
  const rest = space === -1 ? '' : body.slice(space).trim()
  if (!isSkillName(name)) return undefined
  return { name, rest }
}

/**
 * Find the summary a typed name resolves to, honouring invocation policy.
 *
 * Matching is exact after the leading `/` is stripped — no prefix matching and
 * no case folding. The palette is where a partial name gets completed; by the
 * time a line is submitted, running something the user did not name is a
 * worse outcome than telling them the name is unknown.
 * @param skills - the catalog to search.
 * @param name - the bare skill name, without a leading `/`.
 * @returns the matching user-invocable summary, or `undefined`.
 */
export function findSkill(
  skills: readonly SkillSummary[],
  name: string,
): SkillSummary | undefined {
  return userSkills(skills).find(s => s.name === name)
}
