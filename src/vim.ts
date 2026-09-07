/**
 * Modal (vi-style) editing for the prompt buffer.
 *
 * A pure state machine over `(text, cursor, mode, pending, register)`. No
 * React, no Ink, no I/O — {@link applyVim} takes a keystroke and returns what
 * the buffer becomes, which is what lets the whole keymap be tested without
 * painting a frame. `Prompt.tsx` consults it first when the user has switched
 * keybinds on, and falls back to its ordinary editing path for anything this
 * module declines.
 *
 * **Only normal mode is modal.** Insert mode is deliberately *not* implemented
 * here: it is the editor the prompt already had, keystroke for keystroke, so a
 * user who never presses `Esc` cannot tell the two keybind settings apart. That
 * is the point — turning vim on must not cost you the emacs motions
 * (`Ctrl-A`/`Ctrl-E`/`Ctrl-W`), the palette, the file picker, history recall or
 * paste handling, all of which live in `Prompt.tsx` and all of which keep
 * working. This module answers exactly one question: what does this key do
 * while the buffer is in normal mode?
 *
 * **Line-scoped where vi is line-scoped.** `0`, `$`, `dd`, `o` and friends act
 * on the *logical* line — the text between newlines — while the prompt's own
 * `Ctrl-A`/`Ctrl-K` are buffer-scoped (`prompt-editing.ts` explains why). The
 * inconsistency is intentional and runs the same way in both directions: a
 * `Ctrl-A` that stopped at a newline would surprise a readline user, and a `0`
 * that jumped to the top of a three-line paste would surprise a vi user. Each
 * key means what the person pressing it expects.
 *
 * **What is not here, and is not a TODO.** No counts (`3w`), no visual mode, no
 * undo, no named registers, no `:` commands, no search. Each is a real feature
 * with a real cost, and none of them is what makes modal editing worth having
 * in a one-to-ten-row prompt — the win is `b`/`w`/`ciw`-shaped motion over a
 * line you are still composing. A build that shipped a half-working `u` would
 * be worse than one that never offered it, because the user would find out
 * which by losing a line.
 * @module @deepseek-ai/dsh-tui/vim
 */

/** Which editor the prompt's keys currently mean. */
export type VimMode = 'insert' | 'normal'

/**
 * Which keymap the prompt runs, as the user set it.
 *
 * `default` is the emacs-flavoured readline editor the prompt has always had.
 * `vim` layers normal mode on top of it — *on top of*, not instead of, which is
 * why there is no third value: insert mode and `default` are the same editor,
 * so "emacs" would be a synonym rather than a choice.
 */
export type KeybindPref = 'default' | 'vim'

/** Every value {@link KeybindPref} can take, in the order `/keybinds` lists them. */
export const KEYBIND_PREFS: readonly KeybindPref[] = ['default', 'vim']

/**
 * Whether a value read from the preference file is a keybind setting.
 * @param value - the parsed value, of unknown shape.
 */
export function isKeybindPref(value: unknown): value is KeybindPref {
  return typeof value === 'string' && (KEYBIND_PREFS as readonly string[]).includes(value)
}

/**
 * Everything normal mode remembers between keystrokes.
 *
 * `pending` holds a half-typed operator (`d` waiting for its motion, or the
 * first `g` of `gg`). `register` holds the last deletion, for `p`. Both are
 * plain strings so the whole state is trivially serialisable and comparable in
 * a test.
 */
export interface VimState {
  mode: VimMode
  pending: string
  register: string
}

/** Normal mode with nothing half-typed and nothing yanked. */
export const INITIAL_VIM: Readonly<VimState> = { mode: 'insert', pending: '', register: '' }

/** The keystroke, reduced to what this module can act on. */
export interface VimKey {
  /** The character, already stripped of modifiers by Ink. */
  input: string
  /** True for Esc. */
  escape: boolean
  /** True for Enter — normal mode passes it through so the line can be sent. */
  return: boolean
}

/**
 * What one keystroke did.
 *
 * `handled: false` is the important member: it means this module declines the
 * key and the caller's ordinary editing path must run. Insert mode declines
 * everything except `Esc`, which is how the prompt keeps its whole existing
 * keymap while modal editing is switched on.
 */
export type VimResult =
  | { handled: false }
  | {
    handled: true
    text: string
    cursor: number
    state: VimState
    /**
     * Move the caret one *wrapped display row*, rather than to the index in
     * `cursor`. `j`/`k` are the one pair whose destination this module cannot
     * compute: it depends on the measured text width, which lives in the
     * component. The caller applies its own row mover and ignores `cursor`.
     */
    rowDelta?: -1 | 1
  }

/** Index of the first character of the logical line the caret sits on. */
export function lineStart(text: string, cursor: number): number {
  const at = clamp(text, cursor)
  const found = text.lastIndexOf('\n', at - 1)
  return found === -1 ? 0 : found + 1
}

/** Index of the newline ending the caret's logical line, or the buffer's end. */
export function lineEnd(text: string, cursor: number): number {
  const found = text.indexOf('\n', clamp(text, cursor))
  return found === -1 ? text.length : found
}

/**
 * Index of the first non-blank character of the caret's line — vi's `^`.
 * A blank line answers with its own start, so the caret does not leave it.
 */
export function firstNonBlank(text: string, cursor: number): number {
  const start = lineStart(text, cursor)
  const end = lineEnd(text, cursor)
  let at = start
  while (at < end && /\s/.test(text.charAt(at))) at += 1
  return at === end ? start : at
}

/**
 * Start of the next word after the caret — vi's `w`.
 *
 * Whitespace-delimited, the definition `prompt-editing.ts` argues for and for
 * the same reason: the words in a prompt are file paths and flags, and a `w`
 * that stopped inside `~/.dsh/.env` would be a key you press six times.
 */
export function nextWordStart(text: string, cursor: number): number {
  let at = clamp(text, cursor)
  while (at < text.length && !/\s/.test(text.charAt(at))) at += 1
  while (at < text.length && /\s/.test(text.charAt(at))) at += 1
  return at
}

/** Start of the word at or before the caret — vi's `b`. */
export function prevWordStart(text: string, cursor: number): number {
  let at = clamp(text, cursor)
  while (at > 0 && /\s/.test(text.charAt(at - 1))) at -= 1
  while (at > 0 && !/\s/.test(text.charAt(at - 1))) at -= 1
  return at
}

/**
 * One past the last character of the word the caret is in or approaching —
 * vi's `e`.
 *
 * One *past*, unlike vi, and the caret is why: this prompt draws a bar between
 * two characters rather than a block over one (see `Prompt.tsx`), so "the end
 * of the word" is the position after its last character, not on it. The whole
 * keymap is built on that reading — `$` sits after the final character too, and
 * `x` deletes the character the bar is in front of — so `e` following the same
 * rule is what keeps `de` and `e` agreeing.
 */
export function wordEnd(text: string, cursor: number): number {
  let at = clamp(text, cursor)
  // Step off the current position first, or `e` pressed twice would never
  // leave the word it is already at the end of.
  at += 1
  while (at < text.length && /\s/.test(text.charAt(at))) at += 1
  while (at < text.length && !/\s/.test(text.charAt(at))) at += 1
  return Math.min(at, text.length)
}

/**
 * Where a motion key lands the caret, or `undefined` when the key is not a
 * motion. Exported because the operator path (`d`, `c`) needs exactly this
 * answer, and because a motion that moves the caret and the same motion that
 * bounds a deletion must never be allowed to disagree.
 * @param key - the motion character.
 * @param text - the buffer.
 * @param cursor - the caret index.
 * @returns the destination index, or `undefined` when `key` is not a motion.
 */
export function motionTarget(key: string, text: string, cursor: number): number | undefined {
  const at = clamp(text, cursor)
  switch (key) {
    case 'h': return Math.max(lineStart(text, at), at - 1)
    case 'l': return Math.min(lineEnd(text, at), at + 1)
    case '0': return lineStart(text, at)
    case '^': return firstNonBlank(text, at)
    case '$': return lineEnd(text, at)
    case 'w': return nextWordStart(text, at)
    case 'b': return prevWordStart(text, at)
    case 'e': return wordEnd(text, at)
    case 'G': return text.length
    default: return undefined
  }
}

/**
 * Apply one keystroke.
 * @param state - the current mode, pending operator and register.
 * @param key - the keystroke.
 * @param text - the buffer.
 * @param cursor - the caret index.
 * @returns what the buffer and the mode become, or `{ handled: false }` when
 *   the caller's ordinary editing path should run instead.
 */
export function applyVim(
  state: VimState,
  key: VimKey,
  text: string,
  cursor: number,
): VimResult {
  const at = clamp(text, cursor)
  // Esc is the whole of insert mode's keymap. It also clears a half-typed
  // operator, so a stray `d` never waits forever for a motion the user has
  // since forgotten they owe it.
  if (key.escape) {
    if (state.mode === 'insert') {
      // The caret stays where it is. vi steps left on leaving insert because
      // its block caret would otherwise sit past the end of the line; this
      // prompt draws a bar *between* characters, where the position after the
      // last one is a real place to be. Stepping left here would move the
      // caret off the character the user just typed for no reason they could
      // see.
      return done(text, at, { ...state, mode: 'normal', pending: '' })
    }
    // Normal mode with something pending eats the key to cancel it; otherwise
    // Esc is not ours — the palette and the running turn both want it, and a
    // vim user who cannot cancel a turn has lost more than they gained.
    if (state.pending !== '') return done(text, at, { ...state, pending: '' })
    return { handled: false }
  }
  if (state.mode === 'insert') return { handled: false }
  // Enter in normal mode sends the line. Not ours: `Prompt.tsx` owns
  // submission, history and the palette's exact-match rule, and duplicating
  // any of that here would give the two paths a chance to disagree.
  if (key.return) return { handled: false }

  const input = key.input
  if (input === '') return { handled: false }

  // A pending operator consumes the next key as its motion.
  if (state.pending === 'd' || state.pending === 'c') return operate(state, state.pending, input, text, at)
  if (state.pending === 'g') {
    const next = { ...state, pending: '' }
    if (input === 'g') return done(text, 0, next)
    return done(text, at, next)
  }

  switch (input) {
    // Motions.
    case 'h': case 'l': case '0': case '^': case '$': case 'w': case 'b': case 'e': {
      const target = motionTarget(input, text, at)
      return done(text, target ?? at, state)
    }
    case 'G': return done(text, text.length, state)
    case 'g': return done(text, at, { ...state, pending: 'g' })
    // `j`/`k` move by wrapped display row, which only the component can
    // measure — see `rowDelta`.
    case 'k': return { handled: true, text, cursor: at, state, rowDelta: -1 }
    case 'j': return { handled: true, text, cursor: at, state, rowDelta: 1 }

    // Entering insert mode.
    case 'i': return done(text, at, insertAt(state))
    case 'a': return done(text, Math.min(lineEnd(text, at), at + 1), insertAt(state))
    case 'I': return done(text, firstNonBlank(text, at), insertAt(state))
    case 'A': return done(text, lineEnd(text, at), insertAt(state))
    case 'o': {
      const end = lineEnd(text, at)
      return done(`${text.slice(0, end)}\n${text.slice(end)}`, end + 1, insertAt(state))
    }
    case 'O': {
      const start = lineStart(text, at)
      return done(`${text.slice(0, start)}\n${text.slice(start)}`, start, insertAt(state))
    }

    // Deletions that need no motion.
    case 'x': {
      const end = lineEnd(text, at)
      if (at >= end) return done(text, at, state)
      return cut(text, at, at + 1, state, at)
    }
    case 'D': return cut(text, at, lineEnd(text, at), state, at)
    case 'C': {
      const result = cut(text, at, lineEnd(text, at), state, at)
      return result.handled ? done(result.text, result.cursor, insertAt(result.state)) : result
    }
    case 'd': return done(text, at, { ...state, pending: 'd' })
    case 'c': return done(text, at, { ...state, pending: 'c' })

    // The register.
    case 'p': {
      if (state.register === '') return done(text, at, state)
      const paste = state.register
      // A line-wise register (one that ends in a newline, as `dd` leaves it)
      // opens a line below, the way vi does. Anything else lands after the
      // caret.
      if (paste.endsWith('\n')) {
        const end = lineEnd(text, at)
        return done(`${text.slice(0, end)}\n${paste.slice(0, -1)}${text.slice(end)}`, end + 1, state)
      }
      const insert = Math.min(lineEnd(text, at), at + 1)
      return done(`${text.slice(0, insert)}${paste}${text.slice(insert)}`, insert + paste.length - 1, state)
    }
    case 'P': {
      if (state.register === '') return done(text, at, state)
      const paste = state.register
      if (paste.endsWith('\n')) {
        const start = lineStart(text, at)
        return done(`${text.slice(0, start)}${paste}${text.slice(start)}`, start, state)
      }
      return done(`${text.slice(0, at)}${paste}${text.slice(at)}`, at + paste.length - 1, state)
    }

    default:
      // Every other key is swallowed rather than typed. This is the one thing
      // normal mode must get right: falling through would put a literal `q` in
      // the buffer, and a modal editor that sometimes types its commands is
      // worse than no modal editor at all.
      return done(text, at, state)
  }
}

/** Delete `[from, to)`, keep it in the register, and land the caret. */
function cut(text: string, from: number, to: number, state: VimState, caret: number): VimResult {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  const next = `${text.slice(0, start)}${text.slice(end)}`
  const register = text.slice(start, end)
  return done(next, Math.min(caret, Math.max(0, next.length)), { ...state, register, pending: '' })
}

/** Resolve `d`/`c` against the motion key that followed it. */
function operate(state: VimState, operator: 'd' | 'c', input: string, text: string, at: number): VimResult {
  const cleared = { ...state, pending: '' }
  // `dd` / `cc` are line-wise. `dd` takes the newline with the line so the
  // register pastes as a line; `cc` keeps the line's own newline in place,
  // because you are replacing the text on it, not removing the line.
  if (input === operator) {
    const start = lineStart(text, at)
    const end = lineEnd(text, at)
    if (operator === 'c') {
      const result = cut(text, start, end, cleared, start)
      return result.handled ? done(result.text, result.cursor, insertAt(result.state)) : result
    }
    const withNewline = end < text.length ? end + 1 : end
    const result = cut(text, start, withNewline, cleared, start)
    return result.handled
      ? done(result.text, Math.min(result.cursor, result.text.length), {
        ...result.state,
        // A line-wise register is marked by its trailing newline; `d$` and
        // friends never leave one, which is how `p` tells them apart.
        register: text.slice(start, end) + '\n',
      })
      : result
  }
  const target = motionTarget(input, text, at)
  // An operator followed by something that is not a motion is abandoned, not
  // guessed at. `dq` deleting *something* would be the worst possible answer.
  if (target === undefined) return done(text, at, cleared)
  const result = cut(text, at, target, cleared, Math.min(at, target))
  if (!result.handled) return result
  return operator === 'c' ? done(result.text, result.cursor, insertAt(result.state)) : result
}

/** Switch to insert mode, dropping any pending operator. */
function insertAt(state: VimState): VimState {
  return { ...state, mode: 'insert', pending: '' }
}

/** A handled result, with the caret clamped into the buffer. */
function done(text: string, cursor: number, state: VimState): VimResult {
  return { handled: true, text, cursor: clamp(text, cursor), state }
}

/** Clamp a caret index into `[0, text.length]`. */
function clamp(text: string, cursor: number): number {
  return Math.max(0, Math.min(text.length, cursor))
}
