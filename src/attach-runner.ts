/**
 * The one place in the package that reads image bytes and commits them to the
 * attachment store. Kept apart from [attachments.ts](./attachments.ts) so the
 * detection rules stay testable without a filesystem, following the same split
 * as [shell.ts](./shell.ts) / [shell-runner.ts](./shell-runner.ts).
 *
 * Two rules shape the whole file:
 *
 *   - **A bad attachment never costs the user their message.** Every failure
 *     below attaches less and sends the text anyway. Losing a typed line to a
 *     path that turned out not to be an image is the worst outcome available
 *     here, and it is the one outcome this module makes impossible.
 *   - **A path that does not exist is silent.** `findImageCandidates` is
 *     deliberately generous so that `here's the failing screen: ./shot.png`
 *     works; the price is that `the logo.png needs redoing` also arrives as a
 *     candidate. Answering that with a warning row would put a complaint under
 *     every sentence that names a file. A missing file is therefore not a
 *     refusal — it is simply not an attachment, and the absence of a chip is
 *     the whole report.
 *
 * Everything is injected, so the tests drive it with neither a real store nor a
 * real directory.
 * @module @deepseek-ai/dsh-tui/attach-runner
 */

import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import {
  displayName,
  findImageCandidates,
  resolveCandidate,
  textWithoutCandidates,
  type ImageCandidate,
} from './attachments.ts'
import type { Catalog } from './i18n.ts'
import { formatBytes } from './message-layout.ts'

/**
 * The part of `AttachmentStore` this module uses.
 *
 * Structural rather than the class itself: the real store is a cordis `Service`
 * whose constructor wants a `Context`, and requiring a test to build one to
 * check a size limit would be a test of cordis instead of a test of this file.
 */
export interface ImageStore {
  readonly imageLimits: ImageAttachmentLimits
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
}

/** Whether the current route will accept an image at all. */
export type ImageSupport =
  /** The model declares the `image` input modality. */
  | 'yes'
  /**
   * The model declares its modalities and `image` is not among them. The type's
   * own contract calls this negative capability, so it is a refusal.
   */
  | 'no'
  /**
   * No modality list was disclosed. Most provider listings disclose none, so
   * refusing here would break nearly every route; the attachment is attempted
   * and the provider gets to be the one that objects.
   */
  | 'unknown'

/** Why one image, or the whole attempt, did not go through. */
export type AttachRefusal =
  /** The file is there but could not be read — permissions, a directory, a device. */
  | { kind: 'unreadable'; name: string }
  /** Larger than `imageLimits.maxImageBytes`. */
  | { kind: 'too-large'; name: string; bytes: number; limit: number }
  /** More images in the line than `imageLimits.maxImagesPerMessage`. */
  | { kind: 'too-many'; dropped: number; limit: number }
  /** The images that fit individually exceed `maxMessageImageBytes` together. */
  | { kind: 'too-much'; dropped: number; limit: number }
  /** The store refused the bytes — the declared type did not match them, typically. */
  | { kind: 'rejected'; name: string; message: string }
  /** No attachment service is mounted. A misconfigured bundle, not a user error. */
  | { kind: 'no-store' }
  /** The route declares it does not take images. */
  | { kind: 'unsupported'; model: string }

/** What {@link attachImages} produced from one submitted line. */
export interface AttachOutcome {
  /** Durable refs, in the order their paths appeared in the line. */
  refs: ImageAttachmentRef[]
  /** The line with the attached tokens taken out; what the text block carries. */
  text: string
  /** Everything the user should be told, in the order it was decided. */
  refusals: AttachRefusal[]
}

/** Everything {@link attachImages} needs from the outside world. */
export interface AttachDeps {
  /** Directory a relative path is relative to. */
  cwd: string
  /** `$HOME`, or `undefined` when the environment has none. */
  home?: string
  /** The mounted store, or `undefined` when the bundle provides none. */
  store?: ImageStore
  /** Read a resolved absolute path. Rejects the way `fs.readFile` does. */
  readFile: (path: string) => Promise<Uint8Array>
  /**
   * Whether the current route takes images, and what to call it in a refusal.
   * A function because resolving it costs a provider call, and this module is
   * the only thing that knows whether one is needed at all.
   */
  imageSupport: () => Promise<{ support: ImageSupport; model: string }>
}

/** `true` when the read failed because there is nothing at that path. */
function isMissing(error: unknown): boolean {
  const code: unknown = (error as { code?: unknown } | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
}

/** The refusal-free outcome for a line with nothing to attach. */
function nothingToAttach(text: string, refusals: AttachRefusal[] = []): AttachOutcome {
  return { refs: [], text: text.trim(), refusals }
}

/**
 * Read every image the line names, commit it, and report what is left.
 *
 * The route capability is resolved *after* candidates are found and before any
 * byte is read: a line with no image path must never trigger a provider call,
 * and a route that refuses images must never cause a file read.
 */
export async function attachImages(text: string, deps: AttachDeps): Promise<AttachOutcome> {
  const candidates = findImageCandidates(text)
  if (candidates.length === 0) return nothingToAttach(text)

  if (deps.store === undefined) return nothingToAttach(text, [{ kind: 'no-store' }])
  const store = deps.store

  const { support, model } = await deps.imageSupport()
  if (support === 'no') return nothingToAttach(text, [{ kind: 'unsupported', model }])

  const limits = store.imageLimits
  const refusals: AttachRefusal[] = []
  const refs: ImageAttachmentRef[] = []
  const attached: ImageCandidate[] = []
  let budget = limits.maxMessageImageBytes
  let overCount = 0
  let overBudget = 0

  for (const candidate of candidates) {
    const path = resolveCandidate(candidate, deps)
    // Unresolvable (`~` with no `$HOME`) is the missing-file case: not an
    // attachment, and not worth a row.
    if (path === undefined) continue

    let data: Uint8Array
    try {
      data = await deps.readFile(path)
    } catch (error) {
      if (!isMissing(error)) refusals.push({ kind: 'unreadable', name: displayName(candidate) })
      continue
    }

    // Counted only against files that turned out to be real, so a sentence
    // naming a dozen nonexistent images cannot report an overflow.
    if (refs.length >= limits.maxImagesPerMessage) {
      overCount += 1
      continue
    }
    if (data.byteLength > limits.maxImageBytes) {
      refusals.push({
        kind: 'too-large',
        name: displayName(candidate),
        bytes: data.byteLength,
        limit: limits.maxImageBytes,
      })
      continue
    }
    if (data.byteLength > budget) {
      overBudget += 1
      continue
    }

    try {
      refs.push(await store.saveImage({
        data,
        mediaType: candidate.mediaType,
        name: displayName(candidate),
      }))
    } catch (error) {
      // The store verifies the bytes against the declared media type, so its
      // message is the accurate one — a `.png` holding JPEG bytes lands here.
      refusals.push({
        kind: 'rejected',
        name: displayName(candidate),
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    budget -= data.byteLength
    attached.push(candidate)
  }

  if (overCount > 0) {
    refusals.push({ kind: 'too-many', dropped: overCount, limit: limits.maxImagesPerMessage })
  }
  if (overBudget > 0) {
    refusals.push({ kind: 'too-much', dropped: overBudget, limit: limits.maxMessageImageBytes })
  }
  return { refs, text: textWithoutCandidates(text, attached), refusals }
}

/**
 * Classify a route's declared modalities.
 *
 * Absent is `unknown`, not `no`: `LlmModelInfo.inputModalities` documents
 * itself as "absent means unknown, while an explicit omission is negative
 * capability", and honouring that distinction is the difference between
 * supporting images on most providers and supporting them on almost none.
 */
export function classifyModalities(modalities: readonly string[] | undefined): ImageSupport {
  if (modalities === undefined) return 'unknown'
  return modalities.includes('image') ? 'yes' : 'no'
}

/**
 * One refusal as the line to show the user.
 *
 * Lives here rather than in the component that draws it because a refusal is
 * appended as an ordinary `note` from the submit path, which has no renderer to
 * hang a formatter off. The store's own message is passed through unlocalized
 * for the same reason `shell.ts` passes a command's stderr through: it is not
 * ours to word, and a translated approximation of "decoded image/jpeg" would be
 * worse than the accurate English.
 */
export function refusalText(refusal: AttachRefusal, strings: Catalog): string {
  const s = strings.attachments
  switch (refusal.kind) {
    case 'unreadable':
      return s.unreadable(refusal.name)
    case 'too-large':
      return s.tooLarge(refusal.name, formatBytes(refusal.limit))
    case 'too-many':
      return s.tooMany(refusal.dropped, refusal.limit)
    case 'too-much':
      return s.tooMuch(refusal.dropped, formatBytes(refusal.limit))
    case 'rejected':
      return s.rejected(refusal.name, refusal.message)
    case 'no-store':
      return s.noStore
    case 'unsupported':
      return s.unsupported(refusal.model)
    default: {
      const _exhaustive: never = refusal
      return String(_exhaustive)
    }
  }
}
