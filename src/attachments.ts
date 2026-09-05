/**
 * Finding image paths in a submitted line, and the extension/media-type
 * vocabulary that decides what counts as one.
 *
 * Entirely pure: no `fs`, no `ctx`, no attachment store. This module answers
 * *"which parts of this line look like they name an image, and what would be
 * left if they were taken out"*, and nothing else. Whether the file exists,
 * whether its bytes really are a PNG, and whether the model can accept it are
 * three separate questions answered elsewhere — by `stat`, by the attachment
 * store's own byte verification, and by the model's declared modalities.
 *
 * Splitting it that way is not tidiness. Token-finding is the part most likely
 * to be wrong (quoting, escaped spaces, a path mentioned in prose), and it is
 * enormously cheaper to pin by calling it than by typing at a frame — SPEC §3.4.
 *
 * **Why a scanner and not a regex.** A dragged file arrives in whichever form
 * the terminal chose: `'/tmp/a b.png'`, `"/tmp/a b.png"`, or `/tmp/a\ b.png`.
 * All three are one token containing a space, and no single regex reads all
 * three without becoming unreadable. The scanner below is longer than a regex
 * and can be reasoned about a character at a time.
 * @module @deepseek-ai/dsh-tui/attachments
 */

import { basename, extname, isAbsolute, resolve } from 'node:path'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { expandHome } from './shell.ts'

/**
 * Lowercased file extension to the media type it declares.
 *
 * The vocabulary is the attachment store's, not ours: `ImageMediaType` is
 * exactly these four, so a fifth entry here would not survive `saveImage`.
 *
 * This map is a *claim*, never a verification. The store decodes the bytes and
 * checks them against the declared type, so a `.png` holding JPEG bytes is
 * rejected there, with a message that says so. Guessing from the extension is
 * still right at this layer — it is what tells us to consider the token at all.
 *
 * Typed with an explicit `| undefined` because the keys are *extensions found in
 * user text*, not a closed set: a lookup that cannot miss would be a lie, and
 * the miss is the common case.
 */
export const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType | undefined>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** One whitespace-delimited token of a submitted line, and where it sat. */
interface Token {
  /** The token with quoting and backslash escapes removed. */
  value: string
  /** Index of the token's first character in the original text. */
  start: number
  /** Index one past its last character. */
  end: number
}

/**
 * Split a line into whitespace-delimited tokens, honouring the three ways a
 * terminal may deliver a path that contains a space.
 *
 * Quotes and backslashes are consumed as syntax wherever they appear, including
 * mid-token — `foo"bar baz".png` is one token, which is what a shell would say
 * too. A trailing lone backslash is kept as a literal character rather than
 * escaping the end of input, because it is far more likely to be a Windows path
 * fragment than an unfinished escape.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let value = ''
  let start = -1
  let quote: '"' | "'" | undefined

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? ''
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
      // A backslash inside single quotes is literal, as in a shell.
      else if (ch === '\\' && quote === '"' && i + 1 < text.length) {
        i += 1
        value += text[i] ?? ''
      } else value += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      if (start < 0) start = i
      quote = ch
      continue
    }
    if (ch === '\\' && i + 1 < text.length) {
      if (start < 0) start = i
      i += 1
      value += text[i] ?? ''
      continue
    }
    if (/\s/.test(ch)) {
      if (start >= 0) tokens.push({ value, start, end: i })
      value = ''
      start = -1
      continue
    }
    if (start < 0) start = i
    value += ch
  }
  if (start >= 0) tokens.push({ value, start, end: text.length })
  return tokens
}

/** A token of a submitted line that names something we would try to attach. */
export interface ImageCandidate {
  /** The path as typed, with quoting and escapes resolved. Not yet absolute. */
  path: string
  /** Media type its extension claims; the store verifies it against the bytes. */
  mediaType: ImageMediaType
  /** Index of the token's first character in the submitted text. */
  start: number
  /** Index one past its last character. */
  end: number
}

/**
 * Every token of `text` whose extension names an image type.
 *
 * Deliberately generous: this returns candidates, and the caller drops the ones
 * that do not resolve to a readable file. Being generous here and strict at the
 * `stat` is what lets `here's the failing screen: ./shot.png` work while
 * `the logo.png needs redoing` — where no such file sits in the cwd — does not
 * attach anything.
 *
 * A bare extension (`.png` with no stem) is not a candidate: it is a filename
 * only in the sense that a dotfile is, and treating it as one would attach
 * `.png` from the cwd of anyone discussing file formats.
 */
export function findImageCandidates(text: string): ImageCandidate[] {
  const found: ImageCandidate[] = []
  for (const token of tokenize(text)) {
    const mediaType = IMAGE_MEDIA_TYPES[extname(token.value).toLowerCase()]
    if (mediaType === undefined) continue
    if (basename(token.value).startsWith('.')) continue
    found.push({ path: token.value, mediaType, start: token.start, end: token.end })
  }
  return found
}

/**
 * The text left after the attached tokens are taken out.
 *
 * Only tokens that were actually attached are removed, so a candidate the
 * caller rejected stays in the message — the user still gets to say the
 * filename they typed, and the model still sees the sentence they wrote.
 *
 * Whitespace is collapsed rather than left behind: cutting a path out of
 * `look at ./a.png and tell me` must not send `look at  and tell me` with the
 * double space, and cutting the only token must yield an empty string rather
 * than a line of spaces.
 */
export function textWithoutCandidates(
  text: string,
  removed: readonly ImageCandidate[],
): string {
  if (removed.length === 0) return text.trim()
  const ordered = [...removed].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const candidate of ordered) {
    out += text.slice(cursor, candidate.start)
    cursor = candidate.end
  }
  out += text.slice(cursor)
  return out.replaceAll(/\s+/gu, ' ').trim()
}

/** What {@link resolveCandidate} needs from the outside world, passed in. */
export interface ResolveContext {
  /** Directory a relative path is relative to. */
  cwd: string
  /** `$HOME`, or `undefined` when the environment has none. */
  home?: string
}

/**
 * The absolute path a candidate names, or `undefined` when it cannot be
 * resolved at all (`~/x.png` with no `$HOME`).
 *
 * Existence is not checked here; that answer only comes from the read itself,
 * exactly as `resolveCd` leaves it to the `chdir`.
 */
export function resolveCandidate(
  candidate: ImageCandidate,
  ctx: ResolveContext,
): string | undefined {
  const expanded = expandHome(candidate.path, ctx.home)
  if (expanded === undefined) return undefined
  return isAbsolute(expanded) ? expanded : resolve(ctx.cwd, expanded)
}

/**
 * Display name for a ref, stripped of local path information.
 *
 * The store's own contract calls `name` "an optional display name stripped of
 * local path information", so sending the full path would both leak the user's
 * directory layout into the durable log and defeat the field's purpose.
 */
export function displayName(candidate: ImageCandidate): string {
  return basename(candidate.path)
}
