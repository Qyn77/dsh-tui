/**
 * Bracketed-paste decoding for the prompt buffer.
 *
 * A terminal in raw mode sends a pasted newline as `\r`, the same byte the
 * Enter key sends. Nothing downstream can tell the two apart, which is the
 * whole reason bracketed paste exists: with `?2004h` set, the terminal wraps
 * pasted bytes in `ESC [200~` … `ESC [201~`, and everything between the two
 * markers is text by definition rather than by guess.
 *
 * Without that wrapping this app had two failure modes, both reachable by
 * pasting a stack trace into the prompt:
 *
 * - The `\r`s survived into the buffer, where `wrapBuffer` counts only `\n`
 *   as a break. They reached the terminal as carriage returns and shoved the
 *   cursor back to column one, so the pasted lines overprinted each other.
 * - stdin delivers a large paste in several chunks. When a chunk boundary
 *   landed on a newline, that chunk *was* a lone `\r`, Ink's `parseKeypress`
 *   compares with `===` and named it `return`, and the prompt submitted half
 *   a message.
 *
 * Two details of Ink's input path shape the parsing here:
 *
 * - **The markers arrive asymmetrically.** `useInput` strips one leading
 *   `ESC` from every chunk, so a marker that begins a chunk shows up bare
 *   (`[200~`) while one in mid-chunk keeps its escape. Both forms are
 *   accepted; the bare form is what the common case actually delivers.
 * - **A paste spans chunks.** `open` carries the state across them, and while
 *   it is set every byte is text — including a lone `\r` that Ink has already
 *   labelled `return`. That label is what the caller must ignore, and it can
 *   only do so if it consults this module *before* dispatching on the key.
 *
 * Newlines are normalised for unbracketed input too. A real Enter keystroke
 * never reaches a text path — Ink reports it as `key.return`, which the
 * prompt handles earlier — so a `\r` sitting inside an `input` string can
 * only have come from a multi-byte chunk, i.e. from a paste that the terminal
 * declined to bracket. Normalising it is the fallback for those terminals. It
 * cannot fix the split-chunk submission above: a lone `\r` with no
 * surrounding marker is genuinely indistinguishable from Enter, and pretending
 * otherwise would break the Enter key to protect a paste.
 * @module @deepseek-ai/dsh-tui/paste
 */

// Built rather than written literally, same rule as `src/clipboard.ts`: a raw
// ESC byte in source is invisible in every diff and every review that would
// otherwise catch it going missing.
const ESC = '\u001B'
/** Paste opener, minus the ESC that Ink strips when it begins a chunk. */
const START = '[200~'
/** Paste terminator, in the same bare form. */
const END = '[201~'

/** What one input chunk contributed to the prompt buffer. */
export interface PasteChunk {
  /** Text to insert at the caret, with every newline form collapsed to `\n`. */
  text: string
  /** Whether a bracketed paste is still open after this chunk. */
  open: boolean
  /**
   * Whether this chunk was part of a bracketed paste — either it carried a
   * marker, or it arrived while one was open. When set, the caller must treat
   * the chunk as text and skip key dispatch entirely, because Ink may have
   * named a byte in it `return`, `tab` or `backspace`.
   */
  bracketed: boolean
}

/** Collapse `\r\n` and lone `\r` to `\n`; see the module note on why this is safe. */
function normaliseNewlines(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

/**
 * Decode one chunk of Ink input against the running paste state.
 *
 * The loop alternates between the two states rather than scanning for one
 * marker, because a single chunk can legitimately contain both — a short
 * paste arrives whole — and can also carry ordinary keystrokes on either side
 * of the markers.
 * @param input - the `input` string Ink handed to `useInput`.
 * @param open - whether a paste was already open when this chunk arrived.
 * @returns the text to insert and the paste state after this chunk.
 */
export function readPaste(input: string, open: boolean): PasteChunk {
  // Fold the escaped marker forms onto the bare ones so the scan below has a
  // single pair of needles to look for.
  const chunk = input.replaceAll(`${ESC}${START}`, START).replaceAll(`${ESC}${END}`, END)
  let text = ''
  let isOpen = open
  let bracketed = open
  let index = 0
  while (index < chunk.length) {
    if (isOpen) {
      const end = chunk.indexOf(END, index)
      if (end === -1) {
        text += chunk.slice(index)
        break
      }
      text += chunk.slice(index, end)
      index = end + END.length
      isOpen = false
      continue
    }
    const start = chunk.indexOf(START, index)
    if (start === -1) {
      text += chunk.slice(index)
      break
    }
    // Anything before the opener is ordinary typing that shared the chunk.
    text += chunk.slice(index, start)
    index = start + START.length
    isOpen = true
    bracketed = true
  }
  return { text: normaliseNewlines(text), open: isOpen, bracketed }
}
