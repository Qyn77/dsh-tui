/**
 * The `/permission ` picker: preset rows, the anchored query token, and the
 * two ways a choice leaves the list.
 *
 * This is the skill picker's (`skills.ts`) younger sibling, with one
 * difference that shapes every function here: a skill row *is* the command
 * line (`/review` runs the skill), while a preset row is an *argument* to the
 * plugin-provided `/permission` command. Choosing `danger-full-access`
 * therefore submits `/permission danger-full-access`; the TUI owns neither the
 * command nor its vocabulary — the `permissions` session projection advertises
 * the options, and without that service the picker has no rows at all, the
 * same dark-feature stance the StatusBar chip takes in `permissions.ts`.
 * @module @deepseek-ai/dsh-tui/permission-picker
 */

import type { CommandMeta } from './commands.ts'
import type { PermissionPresetSelect } from './types.ts'
import { anchoredTokenAt } from './prompt-editing.ts'

/**
 * Marks the row that is currently in force. The skill picker marks its rows
 * with `◆`; a picker that switches a setting instead needs to say which one is
 * already switched on, and `✓` is the same mark a finished tool earns.
 */
export const CURRENT_PRESET_GLYPH = '✓'

/** The literal prefix the picker anchors on; {@link PermissionMention.start} is its length. */
export const PERMISSION_PREFIX = '/permission '

/** A `/permission <token>` query in the buffer: what it asks for, and what it occupies. */
export interface PermissionMention {
  /** The token typed after `/permission `, which may be empty right after the space. */
  query: string
  /** Index the query token starts at — the position after `/permission `. */
  start: number
  /** Index one past the token's last character. */
  end: number
}

/**
 * Map the projection's advertised presets into picker rows.
 *
 * The row's **name is the bare preset value** (`workspace-write`), not a
 * command: it is what gets typed after `/permission`, and it is deployment
 * data shown verbatim, never translated. The description is the preset's own
 * display name from the projection; the current value carries
 * {@link CURRENT_PRESET_GLYPH} so a glance settles which row is live.
 * @param select - the projection's current value and advertised options.
 * @returns one row per option, in the projection's order.
 */
export function permissionRows(select: PermissionPresetSelect): CommandMeta[] {
  return select.options.map(option => ({
    name: option.value,
    description: option.value === select.currentValue
      ? `${CURRENT_PRESET_GLYPH} ${option.name}`
      : option.name,
  }))
}

/**
 * Find the `/permission ` query token the caret is in, if any.
 *
 * The grammar is the shared command-anchored one (`anchoredTokenAt`): anchor
 * at position 0, one token exactly, a second token closes the picker —
 * `/permission read only` is an already-chosen line being edited, not a
 * two-word filter.
 * @param buffer - the prompt buffer.
 * @param cursor - the caret's index into it.
 * @returns the query token, or `undefined` when the caret is not in one.
 */
export function permissionMentionAt(
  buffer: string,
  cursor: number,
): PermissionMention | undefined {
  return anchoredTokenAt(buffer, cursor, PERMISSION_PREFIX)
}

/**
 * The line choosing a preset submits. Enter's answer — unlike Tab there is no
 * trailing argument phase, because `/permission` takes exactly one word.
 * @param value - a row's bare preset value.
 * @returns the full command line, e.g. `/permission danger-full-access`.
 */
export function permissionCommandLine(value: string): string {
  return `/permission ${value}`
}

/**
 * Replace the `/permission <token>` query with the chosen preset, leaving a
 * space. Tab's answer: the line is completed but not sent, so the choice can
 * be read before Enter dispatches it to the plugin command.
 * @returns the new buffer and where the caret should sit in it.
 */
export function applyPermissionMention(
  buffer: string,
  mention: PermissionMention,
  value: string,
): { text: string; cursor: number } {
  const head = `${PERMISSION_PREFIX}${value} `
  return { text: head + buffer.slice(mention.end), cursor: head.length }
}

/**
 * Filter preset rows by the typed token.
 *
 * Case-insensitive **prefix** match on the bare value, same rule the `/`
 * palette and the skill picker use: preset words are short kebab-case tokens,
 * so a prefix is what the person typing one means. Rows arrive in projection
 * order and leave in it; the floating palette does the windowing.
 * @param rows - the candidate rows, named by bare preset value.
 * @param query - the token typed after `/permission `.
 * @returns the matching rows, input order preserved.
 */
export function filterPermissionRows(
  rows: readonly CommandMeta[],
  query: string,
): CommandMeta[] {
  const wanted = query.toLowerCase()
  return rows.filter(row => row.name.toLowerCase().startsWith(wanted))
}
