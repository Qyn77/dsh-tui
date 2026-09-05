/**
 * Reading the skill registry and turning a typed `/name` into the two messages
 * an invocation is made of. The impure half of `skills.ts`, split the way
 * `shell.ts` / `shell-runner.ts` is: everything that touches `ctx.skills`
 * lives here, and nothing here decides layout or precedence.
 *
 * `@deepseek-ai/dsh-skill` prescribes the shape and this module does not get to
 * improvise on it. A user-explicit invocation is **two** messages, not one
 * concatenated prompt: the user's own words ride a plain user message, and the
 * rendered skill body follows as injected `instructions`-form context carrying
 * a `skill-invocation` source. That is what lets the transcript label the row
 * from metadata instead of re-parsing the model-facing text, and it is what
 * keeps user-supplied prose outside the `<skill_content>` wrapper so a skill's
 * words and the user's cannot be confused for each other.
 *
 * The body itself is `renderSkillContent()`, verbatim. Building our own wrapper
 * would give the model a different shape on the `/` path than the `skill` tool
 * gives it on the model path, for no gain.
 * @module @deepseek-ai/dsh-tui/skill-runner
 */

import {
  renderSkillContent,
  type SkillDefinition,
  type SkillSummary,
  type SkillViewOptions,
} from '@deepseek-ai/dsh-skill'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Context } from '@deepseek-ai/cordis'
import { findSkill, parseSkillLine } from './skills.ts'
import type { Catalog } from './i18n.ts'

/**
 * The slice of `ctx.skills` this module uses. Narrowed to two methods so a
 * test can supply a plain object, and so it is obvious that nothing here
 * registers providers or mutates the catalog.
 */
export interface SkillCatalog {
  snapshot(options?: SkillViewOptions): Promise<{ skills: SkillSummary[]; complete: boolean }>
  get(name: string, options?: SkillViewOptions): Promise<SkillDefinition | undefined>
}

/** What a lookup needs to know about who is asking and from where. */
export interface SkillDeps {
  /** The registry, or `undefined` in an assembly that mounts no skills. */
  readonly skills?: SkillCatalog | undefined
  /** Working directory; providers use it to select project roots. */
  readonly cwd: string
  /** Viewing scope — the calling agent, so its layers shadow the global ones. */
  readonly scope?: object | undefined
}

/** One catalog read, plus whether every provider settled. */
export interface SkillListing {
  /** Winning user-invocable summaries, registry order preserved. */
  readonly skills: SkillSummary[]
  /**
   * Whether discovery completed. An incomplete listing is a partial view, not
   * an error: the caller keeps its last good rows rather than blanking the
   * palette while a slow provider is still starting up.
   */
  readonly complete: boolean
}

/**
 * What a submitted `/name` line resolved to.
 *
 * `unknown` deliberately covers four different causes — no registry mounted, a
 * name outside the skill-name grammar, a name no provider offers, and a name
 * whose skill is model-only. They are one outcome because they produce one
 * user-visible fact: nothing by that name is yours to run. Distinguishing them
 * would mean telling a user that a skill exists but they may not have it,
 * which leaks the catalog the provider chose not to expose.
 */
export type SkillOutcome =
  | { kind: 'unknown' }
  | { kind: 'failed'; name: string }
  | { kind: 'invoked'; name: string; context: UserMessage; prompt: UserMessage }

/**
 * Read the user-invocable catalog for the palette.
 *
 * A missing registry is not an error — it means the built-in table is the
 * whole command surface, the same rule `registryCommands` follows for
 * `ctx.commands`. A registry that throws is treated as an empty incomplete
 * listing rather than propagating: a provider failing to start is not a reason
 * for the prompt to stop accepting input.
 * @param deps - the registry, the working directory, and the viewing scope.
 * @returns the summaries and whether discovery was complete.
 */
export async function listSkills(deps: SkillDeps): Promise<SkillListing> {
  if (deps.skills === undefined) return { skills: [], complete: true }
  try {
    const observed = await deps.skills.snapshot(viewOptions(deps))
    return { skills: observed.skills, complete: observed.complete }
  } catch {
    return { skills: [], complete: false }
  }
}

/**
 * Resolve a submitted `/name …` line into the messages that invoke it.
 *
 * The catalog is read again rather than reusing the palette's copy. A skill is
 * a file on disk that another process may have just rewritten, `skills/change`
 * can fire between opening the palette and pressing Enter, and `cd` moves
 * which project roots are in view — running a stale body is a worse failure
 * than one extra read on a keystroke the user only makes deliberately.
 * @param line - the raw input line, including the leading `/`.
 * @param deps - the registry, the working directory, and the viewing scope.
 * @returns the invocation, a load failure, or `unknown`.
 */
export async function resolveSkill(line: string, deps: SkillDeps): Promise<SkillOutcome> {
  const parsed = parseSkillLine(line)
  if (parsed === undefined || deps.skills === undefined) return { kind: 'unknown' }
  const { skills } = await listSkills(deps)
  const summary = findSkill(skills, parsed.name)
  if (summary === undefined) return { kind: 'unknown' }
  let definition
  try {
    definition = await deps.skills.get(parsed.name, viewOptions(deps))
  } catch {
    return { kind: 'failed', name: parsed.name }
  }
  // Listed but not loadable: the provider saw the file during discovery and
  // could not read it now. Distinct from `unknown` because the user did name
  // something real, and told so they can go look at it.
  if (definition === undefined) return { kind: 'failed', name: parsed.name }
  return {
    kind: 'invoked',
    name: parsed.name,
    context: skillContext(definition),
    prompt: skillPrompt(parsed.rest, line),
  }
}

/**
 * Wrap a loaded skill body as injected `instructions`-form context.
 * @param skill - the loaded definition, as returned by `ctx.skills.get()`.
 * @returns the message to hand to `agent.inject()`.
 */
function skillContext(skill: SkillDefinition): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: renderSkillContent(skill) }],
    source: { kind: 'skill-invocation', name: skill.name, form: 'instructions' },
  })
}

/**
 * Build the plain user message that wakes the driver.
 *
 * `/review the auth change` sends "the auth change" — the invocation is not
 * part of what the user said. But `/review` on its own has no words at all,
 * and an empty message cannot wake anything, so the raw line stands in. That
 * keeps one property true either way: the user's own box only ever shows text
 * the user actually typed.
 * @param rest - the prose after the skill name, already trimmed.
 * @param line - the raw line, used when there is no prose.
 * @returns the message to hand to `agent.followup()` or `agent.steer()`.
 */
function skillPrompt(rest: string, line: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: rest === '' ? line.trim() : rest }],
    source: { kind: 'user' },
  })
}

/**
 * The scope a catalog read should be taken from: the invoking agent's, so its
 * preset's standing skills shadow the global ones.
 *
 * The `ctx` guard is not defensive noise. `scopeOf` indexes the context
 * directly, and an agent assembled without one — a harness double, a host that
 * builds a bare driver — would crash the palette's effect rather than the
 * lookup it was doing. Falling back to the global layer is the honest answer:
 * an agent with no scope has no layers of its own to consult.
 * @param agent - the invoking agent.
 * @returns the viewing scope key, or `undefined` for the global layer alone.
 */
export function viewingScope(agent: { readonly ctx?: Context }): object | undefined {
  return agent.ctx === undefined ? undefined : scopeOf(agent.ctx)
}

/** Assemble the registry's read options, omitting absent keys rather than passing `undefined`. */
function viewOptions(deps: SkillDeps): SkillViewOptions {
  return { cwd: deps.cwd, ...(deps.scope !== undefined ? { scope: deps.scope } : {}) }
}

/**
 * The note shown when a named skill would not load.
 * @param name - the skill the user asked for.
 * @param strings - the interface catalog.
 * @returns one line of warn-toned prose.
 */
export function skillFailureText(name: string, strings: Catalog): string {
  return strings.skills.loadFailed(name)
}
