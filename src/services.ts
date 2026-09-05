/**
 * Typed reads of the Cordis service store.
 *
 * Cordis declares two `get` overloads: `get<K extends string & keyof this>(name: K): this[K] | undefined`
 * for services some package declares on `Context`, and `get(name: string): any`
 * for everything else. This module exists because of two separate problems
 * with that pair — one real, one a tooling limitation. Both are worth reading
 * before deciding this file is redundant indirection.
 *
 * **1. `appExit` genuinely is `any`.** No package installed here declares it
 * on `Context`; it comes from whichever launcher mounted this plugin, so it
 * takes the `any` fallback under *any* checker. Because the hook is threaded
 * from `run()` through `App`'s `exit` prop into `interrupt.ts`, that single
 * `any` spread across the whole exit path — the one path where a silent type
 * error means the process fails to exit and the user is left with a wedged
 * terminal.
 *
 * **2. `service()` works around an oxlint/tsgolint limitation, not a `tsc`
 * one.** `tsc` resolves the typed overload correctly: written directly,
 * `ctx.get('agents')` is already `AgentRegistry | undefined`. oxlint's
 * type-aware engine does not — it falls through to the `any` overload for a
 * string-literal argument, and reports the `no-unsafe-*` family across every
 * call site as a result. Routing those reads through one generic (where
 * tsgolint *does* resolve `keyof this`) makes the linter agree with the
 * compiler, so the remaining `no-unsafe-*` findings in this package are all
 * real ones rather than noise a reader has to learn to skip.
 *
 * If a future oxlint fixes that overload resolution, `service()` becomes pure
 * indirection and should be deleted in favour of calling `ctx.get` directly.
 * `appExit()` should not — reason 1 is permanent.
 * @module @deepseek-ai/dsh-tui/services
 */

import type { Context } from '@deepseek-ai/cordis'
// These empty type imports are load-bearing: each carries the package's
// `interface Context` merge, which is what gives `keyof Context` below its
// service names and `Context[K]` their types. Dropping one does not fail the
// build — it silently narrows `keyof Context` and turns that service name into
// a compile error at the call site.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'

/**
 * Read a service that some installed package declares on `Context`.
 *
 * `K` is constrained to `keyof Context`, so a misspelled service name is a
 * compile error here.
 * @param ctx - the context to read from.
 * @param name - a service name declared on `Context`.
 * @returns the service, or `undefined` when it is not (yet) provided.
 */
export function service<K extends string & keyof Context>(ctx: Context, name: K): Context[K] | undefined {
  // `tsc` already infers exactly this type and flags the assertion as
  // redundant under `no-unnecessary-type-assertion`; it is written anyway so
  // the signature states the contract for the checker that needs it. Removing
  // it would restore the `any` leak in oxlint's view — see reason 2 above.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
  return ctx.get(name) as Context[K] | undefined
}

/**
 * The launcher's process exit hook, provided as `appExit`.
 *
 * Stated here rather than read from a `Context` merge, and so must be kept in
 * sync with the launcher by hand. Declaring it via module augmentation instead
 * was rejected: if the launcher ever ships its own declaration, two
 * non-identical merges of one property are a hard compile error in every
 * consumer, and this package could not fix that from the outside.
 */
export type AppExit = (code: number) => void

/**
 * Read the launcher-provided `appExit` hook.
 *
 * Callers keep their own fallback for the case where no launcher provided one:
 * a bare `dsh-tui` mounted in a test harness has no exit hook, and that is
 * legitimate rather than an error.
 * @param ctx - the context to read from.
 * @returns the exit hook, or `undefined` when no launcher provided one.
 */
export function appExit(ctx: Context): AppExit | undefined {
  return ctx.get('appExit') as AppExit | undefined
}
