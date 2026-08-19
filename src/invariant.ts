/**
 * Empty runtime invariant companion. The TUI bundle has no owned event/data
 * relations to check on a settled tree: every session event is a durable fact
 * owned by `dsh-session`, every agent status by `dsh-agent`, and the
 * `session/event` subscription the TUI registers is a normal `ctx.on` whose
 * `off` is returned to React's effect cleanup. Nothing here would change
 * when this plugin unloads, so the package ships no checks.
 * @module @deepseek-ai/dsh-tui/invariant
 */

export const name = 'dsh-tui/invariant'

/** No runtime invariant. */
export function apply(): void {}
