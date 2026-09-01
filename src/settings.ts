/**
 * The TUI's own persisted preferences, in `~/.dsh/tui.json`.
 *
 * Split the way `environment.ts` splits: {@link parseSettings} and
 * {@link mergeSettings} are pure and carry the tests, while
 * {@link readSettings} and {@link writeSettings} are the only two functions
 * that touch the filesystem.
 *
 * **Reading is total.** No file, an unreadable file, malformed JSON, a JSON
 * scalar where an object belongs, or an unrecognized language code all produce
 * the same answer: the defaults. A preference file is a convenience, and a
 * corrupt one must not be the reason a terminal refuses to open — the worst it
 * can cost the user is one `/language` call.
 *
 * **Writing merges.** The file is read, the known keys are replaced, and
 * everything else is written back untouched. A future version of this package
 * (or the launcher, which shares the `~/.dsh` directory) may keep its own keys
 * here, and `/language` must not be the thing that deletes them.
 *
 * The file is written with default permissions, unlike the `0600` on
 * `~/.dsh/.env`. That mode exists because `.env` holds an API key; an interface
 * language is not a secret, and copying the mode onto a file that does not need
 * it teaches the wrong lesson about which files do.
 * @module @deepseek-ai/dsh-tui/settings
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isLang, type Lang } from './i18n.ts'

/** Preferences this package reads and writes. */
export interface Settings {
  /** Interface language for the TUI's own strings. */
  language: Lang
}

/**
 * What a run gets when the file is absent or unusable.
 *
 * English rather than a guess from `LANG`/`LC_ALL`: those variables describe
 * the locale the *shell* was configured with, which is a poor predictor of the
 * language someone wants their developer tooling in, and sniffing them would
 * make the first frame depend on ambient environment rather than on a choice
 * the user made. `/language zh` is one command, and it persists.
 */
export const DEFAULT_SETTINGS: Readonly<Settings> = { language: 'en' }

/** Directory the dsh family keeps user-level state in. */
export const SETTINGS_DIR = '.dsh'

/** Basename of this package's preference file. */
export const SETTINGS_FILE = 'tui.json'

/**
 * Absolute path of the preference file.
 * @param home - the home directory; defaults to the real one.
 * @returns the path, whether or not anything exists there.
 */
export function settingsPath(home: string = homedir()): string {
  return join(home, SETTINGS_DIR, SETTINGS_FILE)
}

/**
 * Anything parsed out of the file, including keys this version does not know.
 * `unknown` values rather than `any`: every read of a known key is narrowed
 * before use, and an unknown key is only ever copied, never inspected.
 */
type RawSettings = Record<string, unknown>

/**
 * Parse the file's contents into the object it stored, or `undefined` when it
 * held nothing usable.
 *
 * Separate from {@link parseSettings} because a write needs the *unknown* keys
 * too, and a read needs only the known ones.
 * @param raw - the file's text, or `undefined` when there was no file.
 * @returns the stored object, or `undefined` when the text was not one.
 */
export function parseRawSettings(raw: string | undefined): RawSettings | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Hand-edited into invalid JSON, or truncated by a crash mid-write.
    return undefined
  }
  // `typeof null === 'object'`, and a bare `4` or `"zh"` parses fine. Neither
  // is a settings object, and treating one as such would put `undefined` into
  // every known key.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as RawSettings
}

/**
 * Read the known preferences out of the file's text, filling in defaults.
 *
 * Total: every failure mode collapses to {@link DEFAULT_SETTINGS}. A key present
 * but holding a value this version does not recognize is treated as absent,
 * which is what lets an older version read a file a newer one wrote.
 * @param raw - the file's text, or `undefined` when there was no file.
 * @returns complete settings, defaults substituted for anything unusable.
 */
export function parseSettings(raw: string | undefined): Settings {
  const parsed = parseRawSettings(raw)
  if (parsed === undefined) return { ...DEFAULT_SETTINGS }
  const language = parsed['language']
  return {
    language: isLang(language) ? language : DEFAULT_SETTINGS.language,
  }
}

/**
 * Produce the text to write: the existing file with the known keys replaced.
 *
 * Pure, so the merge rule — unknown keys survive — is a test rather than an
 * observation about a temp directory.
 * @param raw - the current file's text, or `undefined` when there is no file.
 * @param update - the known keys to set.
 * @returns the complete text to write, newline-terminated.
 */
export function mergeSettings(raw: string | undefined, update: Partial<Settings>): string {
  const existing = parseRawSettings(raw) ?? {}
  const merged: RawSettings = { ...existing, ...update }
  // Two-space indent and a trailing newline: the file is small, and someone
  // will eventually open it in an editor or `cat` it.
  return `${JSON.stringify(merged, undefined, 2)}\n`
}

/**
 * Read the preference file.
 *
 * The one impure read. Never throws — a missing file is the common case, and
 * every other failure is treated as the same thing.
 * @param home - the home directory; defaults to the real one.
 * @returns complete settings, defaults substituted for anything unusable.
 */
export function readSettings(home: string = homedir()): Settings {
  return parseSettings(readRaw(settingsPath(home)))
}

/**
 * Write the given preferences, preserving keys this version does not know.
 *
 * Never throws. A read-only home directory, a full disk, or a `~/.dsh` that is
 * somehow a file are all real, and none of them is a reason to fail the switch
 * the user just watched take effect on screen — the preference simply does not
 * survive the session.
 * @param update - the known keys to set.
 * @param home - the home directory; defaults to the real one.
 * @returns true when the file was written.
 */
export function writeSettings(update: Partial<Settings>, home: string = homedir()): boolean {
  const path = settingsPath(home)
  try {
    const next = mergeSettings(readRaw(path), update)
    // `recursive` covers both "no `~/.dsh` yet" and "already there", so this
    // needs no existence check of its own.
    mkdirSync(join(home, SETTINGS_DIR), { recursive: true })
    writeFileSync(path, next, { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

/**
 * Read a file's text, or `undefined` when it cannot be read for any reason.
 * @param path - absolute path to read.
 */
function readRaw(path: string): string | undefined {
  try {
    return readFileSync(path, { encoding: 'utf8' })
  } catch {
    return undefined
  }
}
