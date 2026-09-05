/**
 * Pure parsing for the `!` shell escape. No `process`, no `child_process`, no
 * filesystem — path *math* only, so every rule below is testable without a
 * subprocess and without touching the working directory.
 *
 * The one idea worth holding onto: **`cd` cannot be delegated.** Handing
 * `cd src` to `sh -c` changes a child's working directory and then exits, so
 * the next command starts back where it began. A working-directory concept
 * therefore has to live on this side of the spawn, which is why a parser that
 * only ever splits strings has a `cd` case at all.
 * @module @deepseek-ai/dsh-tui/shell
 */

import { isAbsolute, resolve } from 'node:path'

/**
 * Producer name on the context a `!!` escape injects. The reducer recognizes it
 * to avoid drawing our own injection a second time as a `runtime-context` row —
 * the shell row is already on screen with the same text.
 */
export const SHELL_SOURCE_PLUGIN = 'dsh-tui'

/** Default wall-clock budget for one `!` command. */
export const SHELL_TIMEOUT_MS = 120_000

/**
 * Default cap on captured output. Generous enough for a test run or a `git
 * diff`, small enough that it cannot exhaust memory or the scroll buffer.
 */
export const SHELL_MAX_BYTES = 128 * 1024

/** A prompt line recognized as a shell escape. */
export interface ShellEscape {
  /** Everything after the sigil, trimmed. Empty when the user typed a bare `!`. */
  command: string
  /**
   * `true` for `!!` — the command and its output are also queued for the
   * model. `!` keeps them in the view only.
   */
  inject: boolean
}

/**
 * Recognize `!command` / `!!command`. Returns `undefined` for anything that is
 * not a shell escape, so the caller can fall through to its other branches.
 *
 * `!!` is tested before `!` because the shorter sigil is a prefix of the longer
 * one; checked the other way round, `!!ls` would run `!ls` in a shell.
 */
export function parseShellInput(text: string): ShellEscape | undefined {
  const line = text.trimStart()
  if (line.startsWith('!!')) return { command: line.slice(2).trim(), inject: true }
  if (line.startsWith('!')) return { command: line.slice(1).trim(), inject: false }
  return undefined
}

/** Where a recognized `cd` wants to go. */
export type CdTarget =
  /** Bare `cd`, or `cd ~` — the home directory. */
  | { kind: 'home' }
  /** `cd -` — back to wherever the previous `cd` left. */
  | { kind: 'previous' }
  /** `cd <path>`, possibly `~`-prefixed. The path is still unresolved. */
  | { kind: 'path'; path: string }

/**
 * Recognize a line whose *entire* content is a `cd` invocation.
 *
 * Compound lines (`cd src && ls`) deliberately do **not** match. They go to the
 * shell, where the directory change dies with the child exactly as it would in
 * any shell script — surprising for a moment, but it is the behaviour every
 * other shell has, and the alternative is this module growing an opinion about
 * `&&`, `;`, `|` and subshells in order to guess which half to keep.
 */
export function parseCd(command: string): CdTarget | undefined {
  const trimmed = command.trim()
  if (trimmed !== 'cd' && !trimmed.startsWith('cd ')) return undefined
  const rest = trimmed.slice(2).trim()
  if (rest === '' || rest === '~') return { kind: 'home' }
  if (rest === '-') return { kind: 'previous' }
  // Quotes first: `cd "my dir"` is one operand whose spaces are part of the
  // name, so the whitespace guard below must not see them.
  const unquoted = unquote(rest)
  if (unquoted !== rest) return { kind: 'path', path: unquoted }
  // One operand only. A second word means flags or globs we do not implement,
  // and running it in a doomed child is more honest than silently ignoring it.
  if (/\s/.test(rest)) return undefined
  return { kind: 'path', path: rest }
}

/** Strip one layer of matching quotes, so `cd "my dir"` still reaches here. */
function unquote(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value)
  return quoted?.[2] ?? value
}

/** Inputs {@link resolveCd} needs from the outside world, passed in. */
export interface CdContext {
  /** Directory the escape is running from. */
  cwd: string
  /** `$HOME`, or `undefined` when the environment has none. */
  home?: string
  /** Directory the previous `cd` moved away from, for `cd -`. */
  previous?: string
}

/**
 * The absolute path a target means. `undefined` when the target cannot be
 * resolved at all — `cd ~` with no `$HOME`, or `cd -` as the first `cd` of the
 * session. Whether the path *exists* is not this function's business; that
 * answer only comes from the `chdir` itself.
 */
export function resolveCd(target: CdTarget, ctx: CdContext): string | undefined {
  switch (target.kind) {
    case 'home':
      return ctx.home
    case 'previous':
      return ctx.previous
    case 'path': {
      const expanded = expandHome(target.path, ctx.home)
      if (expanded === undefined) return undefined
      return isAbsolute(expanded) ? expanded : resolve(ctx.cwd, expanded)
    }
    default: {
      const _exhaustive: never = target
      return String(_exhaustive)
    }
  }
}

/**
 * Expand a leading `~`. Only a leading one, and only when it is the whole
 * segment: `~/src` and `~` expand, `~user/src` does not (we have no way to look
 * up another account's home) and `./~backup` is a real filename.
 *
 * Exported because `attachments.ts` resolves user-typed paths under the same
 * rules. One copy, so the two cannot drift on which `~` forms count.
 */
export function expandHome(path: string, home?: string): string | undefined {
  if (path !== '~' && !path.startsWith('~/') && !path.startsWith('~\\')) return path
  if (home === undefined) return undefined
  return path === '~' ? home : resolve(home, path.slice(2))
}

/** Result of trimming captured output down to something a frame can hold. */
export interface ClampedOutput {
  text: string
  /** `true` when anything was dropped. The caller says so on screen. */
  truncated: boolean
}

/**
 * Keep the **first** `maxBytes` of output, not the last.
 *
 * A command that produces too much is almost always one whose interesting part
 * is at the top — a compiler's first error, a test run's first failure, the
 * head of a listing. Keeping the tail would show the summary line of something
 * the user can no longer see the cause of.
 *
 * Measured in UTF-8 bytes because that is what the pipe delivers and what a
 * memory bound has to be stated in, then cut back to a whole code point so the
 * result is never a lone surrogate half.
 */
export function clampOutput(text: string, maxBytes: number): ClampedOutput {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= maxBytes) return { text, truncated: false }
  // `toString` on a cut buffer replaces a split code point with U+FFFD; drop
  // that trailing replacement rather than showing it as command output.
  const cut = bytes.subarray(0, maxBytes).toString('utf8').replace(/�$/, '')
  return { text: cut, truncated: true }
}
