/**
 * Read-only facts about the environment the REPL is running in, for
 * display in the startup banner. Every function that touches the
 * outside world is memoized and wrapped, so a render never pays for a
 * second probe and a hostile environment (no git, no repo, no HOME)
 * degrades to `undefined` rather than throwing.
 *
 * The parsing is split from the probing on purpose: `parseGitBranch`
 * and `formatRepoLabel` are pure and carry the tests, while
 * {@link readRepoLabel} is the single impure entry point.
 * @module @deepseek-ai/dsh-tui/environment
 */

import { execFileSync } from 'node:child_process'

/**
 * Injected by tsdown at build time from `package.json#version`. In
 * dev and under vitest the identifier is absent, and `typeof` on an
 * undeclared name is legal JavaScript, so this falls back cleanly
 * instead of throwing a ReferenceError.
 */
declare const __DSH_TUI_VERSION__: string

/** The running version, e.g. `0.1.0-rc.7`, or `dev` outside a build. */
export const VERSION: string =
  typeof __DSH_TUI_VERSION__ === 'string' ? __DSH_TUI_VERSION__ : 'dev'

/** How long to let `git` run before giving up, in milliseconds. */
const GIT_TIMEOUT_MS = 500

/**
 * Pull the branch name out of `git status --porcelain=v2 --branch`
 * output. Returns `undefined` when the header is absent, which is
 * what a detached HEAD or a non-repo produces.
 * @param output - raw stdout from the porcelain-v2 status.
 */
export function parseGitBranch(output: string): string | undefined {
  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      // Porcelain v2 spells a detached HEAD as the literal
      // `(detached)`, which is not a branch name worth showing.
      if (head === '' || head === '(detached)') return undefined
      return head
    }
  }
  return undefined
}

/**
 * True when the porcelain output lists at least one changed,
 * untracked, or unmerged path. Porcelain v2 prefixes headers with
 * `#`; anything else is a path entry.
 * @param output - raw stdout from the porcelain-v2 status.
 */
export function parseGitDirty(output: string): boolean {
  for (const line of output.split('\n')) {
    if (line !== '' && !line.startsWith('#')) return true
  }
  return false
}

/**
 * Compose the display label for a repository, e.g. `main` for a clean
 * tree or `main*` when there is uncommitted work. The `*` is the
 * conventional dirty marker in shell prompts, so it needs no legend.
 * @param branch - branch name, or `undefined` outside a repo.
 * @param dirty - whether the working tree has changes.
 */
export function formatRepoLabel(branch: string | undefined, dirty: boolean): string | undefined {
  if (branch === undefined) return undefined
  return dirty ? `${branch}*` : branch
}

/** Memoized result of {@link readRepoLabel}; `null` means "probed, not a repo". */
let repoLabelCache: string | null | undefined

/**
 * Probe the working directory for a git branch, once per process.
 * Returns `undefined` when the directory is not a repository, git is
 * not installed, or the probe times out — the banner simply omits the
 * label in that case.
 *
 * This is the only impure function in the module. It is memoized
 * because the banner re-renders on every keystroke and a subprocess
 * per keystroke would be indefensible.
 */
export function readRepoLabel(): string | undefined {
  if (repoLabelCache !== undefined) return repoLabelCache ?? undefined
  try {
    const output = execFileSync('git', ['status', '--porcelain=v2', '--branch'], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      // git writes "not a git repository" to stderr; we do not want
      // it leaking into the TUI's own output.
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const label = formatRepoLabel(parseGitBranch(output), parseGitDirty(output))
    repoLabelCache = label ?? null
    return label
  } catch {
    // Not a repo, git missing, or timed out. All three mean the same
    // thing to the banner: there is no branch to show.
    repoLabelCache = null
    return undefined
  }
}
