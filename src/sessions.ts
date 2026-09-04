/**
 * What `/sessions` knows: which stored sessions exist, and enough about each
 * one to recognise it.
 *
 * Resuming was never the missing part — `resume.ts` plans a target and
 * `AgentRegistry.resume` rebuilds the agent. Finding the target was. Session
 * ids are `tui-<uuid>`, so the only request a human could actually form was
 * `last`. These functions turn the store into something readable.
 *
 * Pure, like `plugins.ts` and for the same reason: the listing's ordering,
 * padding and summarisation are the parts worth asserting, and a test of them
 * should not have to mount a persistence backend. The command is left with the
 * IO.
 * @module @deepseek-ai/dsh-tui/sessions
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { isRuntimeContext } from './state.ts'
import { userMessageText } from './types.ts'
import { displayWidth } from './width.ts'

/**
 * How many sessions are listed before the rest become one fold row.
 *
 * The same policy as `/usage` (`MAX_USAGE_ROWS`) and the output previews: cap
 * the height, say what was left out. It doubles as the read budget — the
 * summary column costs one `inspect` per *listed* row, so a store with two
 * hundred sessions still parses ten logs. There is deliberately no `all`
 * argument; it would exist only to undo the cap on the axis the cap protects.
 */
export const MAX_SESSION_ROWS = 10

/** How wide a summary may be before it is cut, in display columns. */
const SUMMARY_MAX = 32

/**
 * How many characters of an id the listing prints.
 *
 * A stored id is `tui-<uuid>` — 40 characters, which on its own is half an
 * 80-column terminal. Printed in full, every other column was pushed off the
 * right edge and truncated away, including the marker saying which row the
 * user was already in. Twelve characters is `tui-` plus the uuid's first
 * group, which is what `planResume` accepts as a unique prefix.
 */
const ID_PREFIX = 12

/** One stored session, as the listing needs it. */
export interface SessionRow {
  id: SessionId
  /** Unix epoch milliseconds, from the stored header. */
  createdAt: number
  /** Working directory the session was created in, if the header carried one. */
  cwd?: string
  /**
   * The first thing the human asked, or `undefined` when there was nothing to
   * read — an empty log, a session that only ever received injections, or one
   * whose log could not be parsed. All three are rendered the same way: blank.
   * A session that cannot be summarised must still be listed, because a corrupt
   * log is exactly when a user is hunting for a session to escape to.
   */
  summary?: string
  /** The session this REPL is running in. Listed, marked, and not resumable. */
  current: boolean
}

/** The words {@link formatSessions} needs. Filled from the catalog. */
export interface SessionLabels {
  /** Marks the row the user is already inside. */
  current: string
  /** Row standing in for the sessions the cap folded away. */
  earlier: (count: number) => string
}

/**
 * Pull a one-line summary out of a stored log.
 *
 * The first `user/message` whose source is the human — `isRuntimeContext`
 * rejects plugin injections, which on a well-configured agent are the *first*
 * few events and would otherwise make every session summarise as the same
 * `<system-reminder>`.
 * @param events - the stored log, in order.
 * @returns the opening request on one line, or undefined when there was none.
 */
export function summarizeLog(events: readonly SessionEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (isRuntimeContext(event.data)) continue
    const text = userMessageText(event.data).replace(/\s+/gu, ' ').trim()
    if (text !== '') return clamp(text, SUMMARY_MAX)
  }
  return undefined
}

/**
 * Cut to a display-column budget rather than a character count. A Chinese
 * opening line is half as many characters as it is columns wide, and a listing
 * whose column width depends on the language wraps in one and not the other.
 */
function clamp(text: string, columns: number): string {
  if (displayWidth(text) <= columns) return text
  let out = ''
  for (const char of text) {
    if (displayWidth(out + char) > columns - 1) break
    out += char
  }
  return `${out}…`
}

/**
 * The prefix of an id that the listing shows and `planResume` accepts.
 *
 * Exported because both ends of that agreement have to mean the same thing: a
 * listing that abbreviates further than resume can resolve would print ids
 * that do not work.
 * @param id - the full stored session id.
 */
export function shortId(id: string): string {
  return id.slice(0, ID_PREFIX)
}

/** Local `YYYY-MM-DD HH:mm`, which is the same length in every locale. */
function stamp(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Shorten a path against `$HOME`, the way a shell prompt does. A stored `cwd`
 * is absolute and the home prefix is the same on every row, so it is width
 * spent saying nothing.
 */
function shortenPath(path: string, home: string | undefined): string {
  if (home === undefined || home === '' || !path.startsWith(home)) return path
  return `~${path.slice(home.length)}`
}

/**
 * Render the rows as a padded table, newest first, with a fold row for the rest.
 *
 * Columns are padded in display columns (`displayWidth`), not characters: the
 * summary is whatever the user typed, and half of this project's users type
 * Chinese. This is the same lesson `/usage` learned about its CJK labels.
 * @param rows - the sessions to show, already sorted and sliced.
 * @param folded - how many the cap left out; zero prints no fold row.
 * @param labels - translated words.
 * @param home - `$HOME`, for shortening the `cwd` column.
 */
export function formatSessions(
  rows: readonly SessionRow[],
  folded: number,
  labels: SessionLabels,
  home: string | undefined = process.env['HOME'],
): string {
  // The current session keeps its summary and gains a word: it is the row
  // whose id the user is most likely to want, and replacing its text with
  // "(this one)" would hide the very thing that makes a row recognisable.
  const cells = rows.map(row => ({
    marker: row.current ? '●' : ' ',
    columns: [
      shortId(row.id),
      stamp(row.createdAt),
      row.cwd === undefined ? '' : shortenPath(row.cwd, home),
    ],
    // The marker word goes *before* the summary, not after: the summary is the
    // one column allowed to run long, so anything past it is what a narrow
    // terminal truncates first, and "which row am I in" must survive that.
    tail: [row.current ? labels.current : '', row.summary ?? ''].filter(part => part !== '').join('  '),
  }))
  // Only the three fixed columns are padded. Padding the trailing cell would
  // add nothing but trailing whitespace, which a preview row spends width on.
  const widths = [0, 1, 2].map(column =>
    Math.max(0, ...cells.map(cell => displayWidth(cell.columns[column] ?? ''))))
  const lines = cells.map((cell) => {
    const padded = cell.columns.map((text, column) =>
      text + ' '.repeat(Math.max(0, (widths[column] ?? 0) - displayWidth(text))))
    return `  ${cell.marker} ${[...padded, cell.tail].join('  ')}`.trimEnd()
  })
  if (folded > 0) lines.push(`    ${labels.earlier(folded)}`)
  return lines.join('\n')
}
