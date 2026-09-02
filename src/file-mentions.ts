/**
 * The `@` file mention: finding one in the buffer, ranking paths against it,
 * and writing the chosen path back.
 *
 * What a mention *is* here is deliberately small. Completing `@src/pro` to
 * `@src/prompt-layout.ts ` saves typing and — more to the point — gets the
 * path right, so the model's file tools open the file the user meant on the
 * first try. It does **not** inline the file's contents into the message: that
 * is a decision about prompt assembly, which belongs to the harness and not to
 * a text box. Anything that reads a mention downstream sees ordinary text.
 *
 * Everything here except {@link listFiles} is pure, for the usual reason
 * (SPEC §3.4): the matching rules are the part most likely to be wrong, and
 * they are much cheaper to pin by calling them than by typing at a frame.
 * @module @deepseek-ai/dsh-tui/file-mentions
 */

import { readdir } from 'node:fs/promises'
import { join, posix, sep } from 'node:path'

/** A `@…` token in the buffer: what it asks for, and what it occupies. */
export interface Mention {
  /** The text after `@`, which may be empty when the user has just typed `@`. */
  query: string
  /** Index of the `@` in the buffer. */
  start: number
  /** Index one past the token's last character. */
  end: number
}

/** Characters that end a mention token. A path with a space in it cannot be completed. */
const BOUNDARY = /\s/

/**
 * Find the mention the caret is in, if any.
 *
 * The `@` has to open a word — a bare `@` after a letter is an email address,
 * a git ref, an npm scope in prose, and in none of those cases does the user
 * want a file list to appear under their hands. The token runs to the next
 * space rather than to the caret, so completing from the middle of a path
 * replaces the whole thing instead of leaving its tail behind.
 * @param buffer - the prompt buffer.
 * @param cursor - the caret's index into it.
 * @returns the mention, or `undefined` when the caret is not in one.
 */
export function mentionAt(buffer: string, cursor: number): Mention | undefined {
  const caret = Math.min(Math.max(0, cursor), buffer.length)
  let start = caret
  while (start > 0 && !BOUNDARY.test(buffer[start - 1] ?? '')) start -= 1
  if (buffer[start] !== '@') return undefined
  let end = caret
  while (end < buffer.length && !BOUNDARY.test(buffer[end] ?? '')) end += 1
  return { query: buffer.slice(start + 1, end), start, end }
}

/**
 * Replace a mention with the chosen path, leaving a trailing space.
 *
 * The space is not cosmetic: it closes the token, which is what makes the
 * picker disappear and the next keystroke ordinary text again.
 * @returns the new buffer and where the caret should sit in it.
 */
export function applyMention(
  buffer: string,
  mention: Mention,
  path: string,
): { text: string; cursor: number } {
  const head = `${buffer.slice(0, mention.start)}@${path} `
  return { text: head + buffer.slice(mention.end), cursor: head.length }
}

/**
 * Score `path` against a fuzzy `query`, or `undefined` if it does not match.
 *
 * A match is a subsequence, case-insensitive, so `mlx` finds
 * `components/MessageList.tsx`. Two bonuses shape the ranking: a character
 * matched right after the previous one (a real prefix beats letters scattered
 * across a long path), and a character matched inside the basename, which is
 * what the user is usually typing. A shorter path breaks what is left.
 *
 * The basename is scanned as a candidate in its own right and the better of
 * the two attempts wins. Without that second pass the leftmost-first scan
 * spends the query's letters on directory names before it ever reaches the
 * filename — `scr` would score `s/c/r.ts` above `src/scroll.ts`, which is the
 * opposite of what a person typing `scr` means.
 * @internal exported for its unit spec.
 */
export function scorePath(path: string, query: string): number | undefined {
  if (query === '') return 0
  const haystack = path.toLowerCase()
  const baseStart = haystack.lastIndexOf('/') + 1
  const whole = subsequenceScore(haystack, query.toLowerCase(), 0, baseStart)
  const base = baseStart === 0
    ? undefined
    : subsequenceScore(haystack, query.toLowerCase(), baseStart, baseStart)
  const best = whole === undefined ? base : Math.max(whole, base ?? whole)
  return best === undefined ? undefined : best - haystack.length / 100
}

/**
 * Greedy leftmost subsequence match of `needle` in `haystack` from `from`.
 * @returns the bonus total, or `undefined` when the letters are not all there.
 */
function subsequenceScore(
  haystack: string,
  needle: string,
  from: number,
  baseStart: number,
): number | undefined {
  let score = 0
  let at = from
  let previous = -2
  for (const char of needle) {
    const found = haystack.indexOf(char, at)
    if (found === -1) return undefined
    if (found >= baseStart) score += 4
    if (found === previous + 1) score += 3
    previous = found
    at = found + 1
  }
  return score
}

/**
 * The best `limit` paths for `query`, best first.
 *
 * Ties break on the incoming order, which {@link listFiles} makes meaningful
 * by walking breadth-first: with nothing else to separate them, the shallower
 * file wins. An empty query is not a rejection — it is the list the user gets
 * for typing a bare `@`.
 */
export function rankPaths(
  paths: readonly string[],
  query: string,
  limit: number,
): string[] {
  const scored: { path: string; score: number; order: number }[] = []
  for (const [order, path] of paths.entries()) {
    const score = scorePath(path, query)
    if (score === undefined) continue
    scored.push({ path, score, order })
  }
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.slice(0, Math.max(0, limit)).map(entry => entry.path)
}

/** Directories never worth walking into. Not configurable, and not missed. */
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'])

/** Hard cap on the walk. Past this the ranking is guesswork anyway. */
export const MAX_SCANNED_FILES = 4000

/**
 * List files under `root`, breadth-first, relative and slash-separated.
 *
 * Breadth-first and capped, rather than exhaustive: a deep `node_modules`-free
 * tree can still hold a hundred thousand files, and the ones a person means to
 * mention are almost never the deepest. Stopping at {@link MAX_SCANNED_FILES}
 * therefore drops the least likely candidates first, which is the only kind of
 * truncation that can be defended.
 *
 * An unreadable directory is skipped, not thrown: a picker that fails because
 * one subdirectory is mode 000 is worse than one that omits it.
 * @param root - directory to walk, usually `process.cwd()`.
 * @param limit - maximum number of files to return.
 */
export async function listFiles(
  root: string,
  limit: number = MAX_SCANNED_FILES,
): Promise<string[]> {
  const files: string[] = []
  const queue: string[] = ['']
  while (queue.length > 0 && files.length < limit) {
    const relative = queue.shift() ?? ''
    let entries
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue
      const child = relative === '' ? entry.name : `${relative}${sep}${entry.name}`
      // Symlinked directories are not followed: a cycle would hang the walk,
      // and the cap alone would only turn that into a slow wrong answer.
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) queue.push(child)
      } else if (entry.isFile()) {
        files.push(sep === posix.sep ? child : child.split(sep).join(posix.sep))
        if (files.length >= limit) break
      }
    }
  }
  return files
}
