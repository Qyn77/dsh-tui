/**
 * `/copy` — put text on the system clipboard through OSC 52.
 *
 * Entirely pure. Unlike `theme.ts` and `file-mentions.ts`, which keep one I/O
 * function beside their pure core, this module never touches a stream: it builds
 * a byte string and returns it, and the App writes it through Ink's own writer.
 * That is possible because copying is *one-way* — OSC 52 is a write with no
 * reply, so there is nothing to read and nothing to own.
 *
 * That one-way-ness is also the module's central limitation, and every message
 * it feeds has to respect it: **the terminal never acknowledges the sequence.**
 * A terminal that does not implement OSC 52, or a tmux without
 * `set-clipboard on`, silently discards it. The app cannot tell that from
 * success, so it reports what it *sent* rather than what landed.
 *
 * There is no `/paste` here, and that is a constraint rather than an omission.
 * Reading the clipboard needs the query form and a read of the reply, which
 * needs a `data` listener on stdin — mid-session, while Ink owns the read loop.
 * `probeAppearance` in `theme.ts` gets away with that only because it runs
 * before Ink mounts; there is no equivalent window once a session is up, and a
 * reply arriving after mount is typed into the prompt as garbage.
 * @module @deepseek-ai/dsh-tui/clipboard
 */

import { parseMarkdown } from './markdown.ts'
import { clampOutput, type ClampedOutput } from './shell.ts'
import type { UiEntry } from './types.ts'

/**
 * Cap on the plaintext handed to {@link osc52}, in UTF-8 bytes. 48 KiB, which
 * base64 grows to 64 KiB.
 *
 * No specification states a maximum. Implementations differ, and the failure
 * mode is the bad one: a sequence a terminal considers too long is dropped
 * without a word, so an uncapped `/copy` on a large reply would report success
 * and copy nothing. The cap is therefore deliberately conservative, and the
 * truncation is *reported* rather than silent — the opposite trade from
 * {@link clampOutput}'s usual caller, where the point of the cap is the frame.
 */
export const OSC52_MAX_BYTES = 48 * 1024

/** Which multiplexer, if any, is between this process and the terminal. */
export type Multiplexer = 'tmux'

/**
 * Detect a multiplexer that needs the sequence wrapped.
 *
 * Injectable default rather than a direct `process.env` read, following
 * `resume.ts#requestFromEnv`: the detection is a fact about a string map, and a
 * test should be able to hand one over.
 *
 * GNU `screen` is deliberately **not** detected. Its passthrough needs the
 * payload split into 512-byte chunks, each separately framed, and a half-right
 * implementation of that would fail on exactly the large copies the chunking
 * exists for — worse than a documented gap, because it would look supported.
 * Note also that `TERM=screen-256color` is what tmux itself often reports, so
 * `TERM` is not evidence of screen either way.
 * @param env - the environment to read, defaulting to this process's.
 */
export function multiplexerFromEnv(env: NodeJS.ProcessEnv = process.env): Multiplexer | undefined {
  return env['TMUX'] === undefined || env['TMUX'] === '' ? undefined : 'tmux'
}

/**
 * ESC and BEL, written as escapes. A literal control byte in source is
 * invisible in a diff and unreviewable, which is the same reason `index.ts`
 * spells its alternate-screen sequences this way.
 */
const ESC = '\u001B'
const BEL = '\u0007'

/** Options for {@link osc52}. */
export interface Osc52Options {
  /** Wrap the sequence for a multiplexer's passthrough. */
  multiplexer?: Multiplexer | undefined
}

/**
 * Build the OSC 52 sequence that sets the clipboard to `text`.
 *
 * The shape is `ESC ] 52 ; c ; <base64> BEL`. `c` is the clipboard selection
 * (as opposed to `p`, the primary selection): a `/copy` is meant for the
 * paste the user is about to do in another application, which is the clipboard
 * on every platform and only sometimes the primary.
 *
 * Under tmux the whole thing is wrapped in DCS passthrough, and **every `ESC`
 * inside the payload is doubled** — including the one that opens the OSC.
 * That doubling is the entire difference between working and silently doing
 * nothing under tmux, which is why it has its own test. The wrap also needs
 * `set-clipboard on` in the user's tmux config; nothing here can supply that.
 * @param text - the plaintext to copy. Clamp it first; see {@link OSC52_MAX_BYTES}.
 * @param options - multiplexer wrapping.
 * @returns the byte string to write to the terminal.
 */
export function osc52(text: string, options: Osc52Options = {}): string {
  const base64 = Buffer.from(text, 'utf8').toString('base64')
  const sequence = `${ESC}]52;c;${base64}${BEL}`
  if (options.multiplexer !== 'tmux') return sequence
  // The closing `ESC \` is the passthrough's own terminator and stays outside
  // the doubling: only the payload's escapes are escaped.
  return `${ESC}Ptmux;${sequence.replaceAll(ESC, ESC + ESC)}${ESC}\\`
}

/** What `/copy` was asked for. */
export type CopyTarget = 'reply' | 'code'

/** Text `/copy` found, and which of the two things it is. */
export interface CopySelection {
  text: string
  target: CopyTarget
}

/**
 * Find the text `/copy` should send, scanning the conversation newest-first.
 *
 * `reply` takes the newest assistant entry's text **as its markdown source**,
 * not as the terminal rendered it: what someone pastes into an editor or an
 * issue should be what the model wrote. A still-streaming reply is eligible —
 * it is what is on screen, and refusing it would mean `/copy` failing for the
 * one thing the user is most likely looking at.
 *
 * `code` takes the newest fenced block *anywhere* in the conversation rather
 * than only in the newest reply, because "copy that snippet" usually comes a
 * few turns after the snippet. It reuses {@link parseMarkdown} instead of
 * matching fences here, so what it copies is byte-for-byte what §1.9 drew.
 *
 * There is no way to name an *older* reply or block. Reaching one needs the
 * focus/selection model SPEC §1.2 and roadmap §6 both decline; see the
 * truncation item for the same wall.
 * @param entries - the visible conversation, oldest first.
 * @param target - which of the two to look for.
 * @returns the selection, or `undefined` when the conversation holds no such thing.
 */
export function pickCopyText(
  entries: readonly UiEntry[],
  target: CopyTarget,
): CopySelection | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    // Indexed inside its own bounds, so the entry is there.
    const entry = entries[i]
    if (entry.kind !== 'assistant' || entry.text === '') continue
    if (target === 'reply') return { text: entry.text, target }
    const blocks = parseMarkdown(entry.text)
      .filter((b): b is { kind: 'code-block'; lang: string; text: string } =>
        b.kind === 'code-block')
    const last = blocks.at(-1)
    if (last !== undefined) return { text: last.text, target }
  }
  return undefined
}

/**
 * Clamp a selection to what {@link osc52} can carry.
 *
 * Split from `osc52` so the caller can report the truncation. A `/copy` that
 * quietly sent half a file would be indistinguishable from one that sent all of
 * it, and the user only finds out when they paste.
 * @param text - the selected plaintext.
 * @returns the text to send and whether anything was dropped.
 */
export function clampForClipboard(text: string): ClampedOutput {
  return clampOutput(text, OSC52_MAX_BYTES)
}

/**
 * UTF-8 byte length, for the count `/copy` reports.
 *
 * Bytes rather than characters because bytes are what was sent and what the cap
 * is stated in — a CJK reply whose character count looks comfortable can still
 * be the one that got clamped.
 * @param text - the text that was sent.
 */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}
