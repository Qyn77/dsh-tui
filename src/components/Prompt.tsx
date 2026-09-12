/**
 * The bottom input box. It grows with the buffer up to
 * {@link MAX_PROMPT_ROWS} rows and then scrolls internally, with a
 * scrollbar column on the right and the caret always in view. `Ctrl-J`
 * inserts a newline; so does a trailing `\` before `Enter`.
 *
 * Two things are worth knowing before editing the layout:
 *
 * - **The buffer is folded by this component, not by Ink.** `<Text>` would
 *   wrap it for free, but then nothing here would know how many rows the
 *   result occupies or which row the caret is on, and both are needed to cap
 *   the height and to scroll. `prompt-layout.ts` does the fold; every row is
 *   drawn verbatim as its own `<Text wrap="truncate">`.
 * - **The text width is measured, not calculated.** `measureElement` reports
 *   the real inner width, the same pattern the MessageList uses for its
 *   viewport. The arithmetic fallback (`columns - 8`) only covers the first
 *   frame, before a measurement exists.
 *
 * When the buffer starts with `/` and contains no space yet, a
 * {@link SlashPalette} floats above the box showing the matching
 * slash commands. ↑/↓ navigate the palette, Tab completes the
 * highlighted name, Enter runs an exact match (otherwise completes),
 * Esc clears the buffer.
 *
 * Three more lists share that one component. Typing `/skill ` opens the
 * skill picker — user-invocable skills used to be rows in the `/`
 * palette and live behind this token now — where Tab inserts `/<name>`
 * and Enter runs the highlighted one. `/permission ` opens the preset
 * picker, whose rows are the projection's advertised presets and whose
 * Enter submits `/permission <value>` to the plugin command. `/model `
 * opens the model picker, whose rows are the current provider's
 * catalogue and whose Enter submits `/model <id>` through the ordinary
 * dispatch. An `@` opens the file picker, the same shape with paths.
 * Only one of the five is ever open, in that precedence: `/` palette,
 * skill picker, permission picker, model picker, file picker.
 *
 * ↑/↓ are shared with the conversation viewport, and Ink dispatches a
 * keystroke to *every* `useInput` handler — there is no bubbling to stop. So
 * ownership is decided here and reported upward through
 * `onArrowClaimChange`: while the palette is open or the buffer occupies
 * more than one row, these keys belong to the prompt and the log's arrow
 * scrolling stands down. `PageUp`/`PageDown` and `Ctrl-B/F/U/D` always
 * belong to the log, so the keyboard never loses its way through history.
 * @module @deepseek-ai/dsh-tui/components/Prompt
 */

import React, { useEffect, useRef, useState, type FC } from 'react'
import { Box, Text, measureElement, useInput, useStdout, type DOMElement } from 'ink'
import { SPINNER_FRAMES } from '../hooks/useRunningClock.ts'
import { filterCommands, type CommandMeta } from '../commands/commands.ts'
import { isMouseReport, isOscTail } from '../render/scroll.ts'
import { readPaste } from '../prompt/paste.ts'
import {
  deleteToEnd,
  deleteToStart,
  deleteWordBefore,
  insertTextAtCursor,
  pushHistory,
  removeCharBeforeCursor,
  wordEndAfter,
  wordStartBefore,
} from '../prompt/prompt-editing.ts'
import {
  MAX_PROMPT_ROWS,
  PALETTE_CHROME_ROWS,
  cursorAt,
  paletteWindowRows,
  moveVertically,
  scrollbarColumn,
  visibleStart,
  wrapBuffer,
} from '../prompt/prompt-layout.ts'
import { applyMention, mentionAt } from '../prompt/file-mentions.ts'
import {
  applySkillMention,
  filterSkillRows,
  skillMentionAt,
} from '../pickers/skills.ts'
import {
  PERMISSION_PREFIX,
  applyPermissionMention,
  filterPermissionRows,
  permissionCommandLine,
  permissionMentionAt,
} from '../pickers/permission-picker.ts'
import {
  MODEL_PREFIX,
  applyModelMention,
  filterModelRows,
  modelCommandLine,
  modelMentionAt,
} from '../pickers/model-picker.ts'
import {
  MCP_ADD_PREFIX,
  applyMcpMention,
  filterMcpPresetRows,
  mcpMentionAt,
  mcpPresetCommandLine,
  mcpPresetRows,
} from '../pickers/mcp-picker.ts'
import { INITIAL_VIM, applyVim, type KeybindPref, type VimState } from '../prompt/vim.ts'
import { useFileMentions } from '../hooks/useFileMentions.ts'
import { SlashPalette } from './SlashPalette.tsx'
import { useLang, useStrings } from '../hooks/useStrings.tsx'

/** Props for {@link Prompt}. */
export interface PromptProps {
  /** Whether input is accepted (false while a shell runs or an approval waits). */
  active: boolean
  /**
   * Whether something is running that `Esc` / `Ctrl-C` would cancel — an agent
   * turn or a `!` shell command. Orthogonal to {@link active}: the prompt takes
   * input during a *turn* so the line can steer it (§1.6), which means the two
   * used to be one flag and no longer are. It picks the caption under the
   * spinner, and it makes `Ctrl-C` stand down — while something is running that
   * key stops it, and clearing the buffer at the same time would answer one
   * keystroke twice.
   */
  busy?: boolean
  /** Called with the full line when the user submits a non-slash message. */
  onSubmit: (text: string) => void
  /** Index into {@link SPINNER_FRAMES} for the running-mode placeholder. */
  spinnerFrame: number
  /**
   * Report whether ↑/↓ currently belong to the prompt. The App forwards the
   * answer to `useMessageListScroll` so the two do not both act on one
   * keystroke. Optional: a prompt rendered without it simply never claims
   * the keys.
   */
  onArrowClaimChange?: (claimed: boolean) => void
  /**
   * Report whether the buffer currently holds anything. Two keys outside this
   * component change meaning based on the answer — `Ctrl-U` deletes to the
   * start of a non-empty buffer instead of scrolling the log, and `Ctrl-C`
   * clears it instead of exiting — and both of those consumers can only see
   * the buffer through this. Optional, like the arrow claim: a prompt
   * rendered without it never takes either key.
   */
  onFilledChange?: (filled: boolean) => void
  /**
   * Report whether `Esc` currently belongs to the prompt — one of the three
   * floating lists is open and Esc dismisses it. The App cancels the running turn
   * on Esc, and since the prompt now takes input *during* a turn (§1.6) the two
   * meanings can be live at the same moment; without this the one press would
   * dismiss the palette and kill the turn. Optional, like the arrow claim.
   */
  onEscClaimChange?: (claimed: boolean) => void
  /**
   * Report how many rows the floating list above the prompt currently
   * occupies — `0` when none of the three floating lists is open.
   *
   * The App subtracts it from the banner's height budget. On an empty session
   * the banner is the tallest thing in the frame and the palette opens *above*
   * the prompt, so with no coordination the two of them together outgrow the
   * terminal, the frame overlaps itself, and half a banner is left stranded on
   * screen until the next resize. Optional, like the other claims: a prompt
   * rendered without it simply never asks the banner for room.
   */
  onOverlayRowsChange?: (rows: number) => void
  /**
   * Commands the plugin registry offers, alongside the built-in table. The
   * prompt has no context to read the registry from, so the App resolves it
   * (see `useRegistryCommands`) and hands the rows down. Optional: a prompt
   * rendered without it advertises the built-in table only.
   */
  extraCommands?: readonly CommandMeta[]
  /**
   * User-invocable skills for the `/skill ` picker. Deliberately separate
   * from {@link extraCommands}: skills do not appear in the `/` palette, and
   * the App already resolved the built-in/plugin shadowing before handing
   * these down. Optional: a prompt rendered without it has no picker.
   */
  skillCommands?: readonly CommandMeta[]
  /**
   * Presets for the `/permission ` picker, bare values with display names.
   * The App builds them from the `permissions` session projection; with no
   * projection mounted the list stays empty, so typing `/permission ` is
   * ordinary text and bare `/permission` reaches the plugin's own usage.
   */
  permissionCommands?: readonly CommandMeta[]
  /**
   * Cycle the permission preset, wired to Tab / Shift+Tab while the buffer is
   * empty and no list is floating — every other Tab meaning (completion in an
   * open list) outranks it. The App owns the preset math and the dispatch; the
   * prompt only decides when the key is free. Absent when no presets are
   * advertised, so the key keeps its old behaviour there.
   */
  onCyclePermission?: (direction: 1 | -1) => void
  /**
   * Models for the `/model ` picker: the current provider's catalogue, bare
   * ids with display names, the live one marked. The App resolves them from
   * `ctx.llm` (see `useModelCommands`); absent or empty means no picker, and
   * bare `/model` keeps the dispatch that prints usage.
   */
  modelCommands?: readonly CommandMeta[]
  /**
   * Which keymap the prompt runs — see `/keybinds` and `src/prompt/vim.ts`. Optional
   * and defaulting to `default`, so a prompt rendered without it is the
   * readline editor it has always been.
   */
  keybinds?: KeybindPref
}

/**
 * Columns the box spends on everything that is not buffer text: the root's
 * reserved right column (1), the border (2), the horizontal padding (2), the
 * `> ` prefix column (2) and the scrollbar column (1). Only used until
 * `measureElement` has a real number.
 */
const CHROME_COLUMNS = 8

/**
 * The single-line prompt with a `\` continuation marker. Backspace works
 * naturally; Enter submits unless the buffer ends in `\`, in which case it
 * becomes a newline character.
 *
 * The text operations themselves live in `prompt-editing.ts` and are
 * re-exported here for the callers that imported them from this module
 * before they moved.
 */
export { insertTextAtCursor, removeCharBeforeCursor } from '../prompt/prompt-editing.ts'

/**
 * The buffer is in "palette mode" when it starts with `/` and has no
 * space yet. A space means "the user is typing arguments" and the
 * palette should disappear so the prompt returns to plain-text mode.
 * @param value - the current buffer.
 */
function isPaletteMode(value: string): boolean {
  return value.startsWith('/') && !value.includes(' ')
}

/**
 * Clamp the palette selection back into range when the filtered list
 * shrinks (e.g. the user keeps typing and the prefix no longer
 * matches anything).
 */
function clampPaletteIndex(index: number, commands: readonly CommandMeta[]): number {
  if (commands.length === 0) return 0
  if (index < 0) return 0
  if (index >= commands.length) return commands.length - 1
  return index
}

export const Prompt: FC<PromptProps> = ({
  active,
  onSubmit,
  spinnerFrame,
  busy = false,
  onArrowClaimChange,
  onFilledChange,
  onEscClaimChange,
  onOverlayRowsChange,
  extraCommands,
  skillCommands,
  permissionCommands,
  onCyclePermission,
  modelCommands,
  keybinds = 'default',
}) => {
  const { stdout } = useStdout()
  const lang = useLang()
  const strings = useStrings()
  const [value, setValue] = useState('')
  const [cursorIndex, setCursorIndex] = useState(0)
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [textWidth, setTextWidth] = useState(0)
  const textRef = useRef<DOMElement | null>(null)
  // The column a vertical walk is aiming for, tagged with the cursor it was
  // taken from. A ref, not state: nothing is drawn from it, so writing it must
  // not cost a render. See `moveCaretRow`.
  const desired = useRef<{ cursor: number; column: number } | null>(null)
  // Whether a bracketed paste is open across chunks. A ref, not state: it has
  // to be readable and writable inside a single `useInput` call, and a paste
  // spanning three chunks must not cost three renders to track.
  const pasting = useRef(false)
  // Submitted lines, newest last, and where in them the user currently is.
  // `null` means "on the live buffer"; `draft` is what that buffer held when
  // they started walking, so Ctrl-N can hand it back.
  const [history, setHistory] = useState<readonly string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  // The `@` of a picker the user has dismissed with Esc. Kept by position so
  // it stays dismissed while they finish typing that token and comes back on
  // the next one, which is what Esc means everywhere else in this prompt.
  const [dismissed, setDismissed] = useState<number | null>(null)
  // Whether the `/skill ` picker was dismissed for the current token. A
  // boolean rather than another position key: the anchor is the constant
  // `/skill `, so the token — not its offset — is the unit it forgets by.
  const [skillDismissed, setSkillDismissed] = useState(false)
  // Modal editing, when the user has asked for it. `INITIAL_VIM` starts in
  // insert, so switching keybinds on mid-session does not swallow the next
  // thing typed — normal mode is a place you go, not a place you land.
  const [vim, setVim] = useState<VimState>(INITIAL_VIM)
  const vimOn = keybinds === 'vim'
  const normalMode = vimOn && vim.mode === 'normal'

  // Filter is a pure derivation from `value`; no effect needed. The
  // selection index is clamped on every keystroke so an out-of-range
  // cursor from rapid input never escapes.
  const palette = isPaletteMode(value) ? filterCommands(value, extraCommands, lang) : []
  const safePaletteIndex = clampPaletteIndex(paletteIndex, palette)

  // How tall either floating list may get. Read from the live terminal
  // height rather than fixed, because the App's root box has a fixed height
  // and an overflowing subtree overlaps instead of scrolling — see
  // `paletteWindowRows`. Ink re-renders the tree on resize, so this tracks.
  const paletteRows = paletteWindowRows(stdout?.rows ?? 24)

  // The `/skill ` picker, between the `/` palette and the `@` picker in
  // precedence: suppressed while the palette is open, and it suppresses the
  // file mention so the two can never both claim ↑/↓ or Tab. Its index rides
  // on `paletteIndex` for the same reason only one list is ever open.
  //
  // There is deliberately no "scanning" row: skill rows arrive in a prop, and
  // before the first complete catalog exists the list is simply absent —
  // unlike a directory walk, nothing is in flight from the user's keystroke.
  const skillMention = palette.length === 0 ? skillMentionAt(value, cursorIndex) : undefined
  const skillPickRows = skillMention === undefined
    ? []
    : filterSkillRows(skillCommands ?? [], skillMention.query)
  const safeSkillIndex = clampPaletteIndex(paletteIndex, skillPickRows)
  const skillTokenActive = skillMention !== undefined
  const pickingSkill = skillTokenActive
    && !skillDismissed
    && skillPickRows.length > 0
  useEffect(() => {
    if (!skillTokenActive) setSkillDismissed(false)
  }, [skillTokenActive])

  // The `/permission ` picker, third in precedence: suppressed while the
  // palette or the skill picker is open, and it suppresses the file mention.
  // Its rows come from the session projection via a prop, the same prop
  // contract the skill picker uses; an empty prop means no projection, which
  // means no picker.
  const [permissionDismissed, setPermissionDismissed] = useState(false)
  const permissionMention = palette.length === 0 && skillMention === undefined
    ? permissionMentionAt(value, cursorIndex)
    : undefined
  const permissionPickRows = permissionMention === undefined
    ? []
    : filterPermissionRows(permissionCommands ?? [], permissionMention.query)
  const safePermissionIndex = clampPaletteIndex(paletteIndex, permissionPickRows)
  const permissionTokenActive = permissionMention !== undefined
  const pickingPermission = permissionTokenActive
    && !permissionDismissed
    && permissionPickRows.length > 0
  useEffect(() => {
    if (!permissionTokenActive) setPermissionDismissed(false)
  }, [permissionTokenActive])

  // The `/model ` picker, fourth in precedence. Rows come from the provider's
  // catalogue via a prop; an empty prop means no llm service, no selection or
  // a listing that has not answered — all of which mean no picker.
  const [modelDismissed, setModelDismissed] = useState(false)
  const modelMention = palette.length === 0
      && skillMention === undefined
      && permissionMention === undefined
    ? modelMentionAt(value, cursorIndex)
    : undefined
  const modelPickRows = modelMention === undefined
    ? []
    : filterModelRows(modelCommands ?? [], modelMention.query)
  const safeModelIndex = clampPaletteIndex(paletteIndex, modelPickRows)
  const modelTokenActive = modelMention !== undefined
  const pickingModel = modelTokenActive
    && !modelDismissed
    && modelPickRows.length > 0
  useEffect(() => {
    if (!modelTokenActive) setModelDismissed(false)
  }, [modelTokenActive])

  // The `/mcp add ` picker, fifth in precedence. Its rows are the static
  // preset catalog (`mcp-catalog.ts`) — no service to read, so the list is
  // never empty and the picker always opens. A `{` at the head of the token
  // means the user is pasting a config block, and `filterMcpPresetRows`
  // returns nothing for it, so a paste is never claimed by the picker.
  const [mcpDismissed, setMcpDismissed] = useState(false)
  const mcpMention = palette.length === 0
      && skillMention === undefined
      && permissionMention === undefined
      && modelMention === undefined
    ? mcpMentionAt(value, cursorIndex)
    : undefined
  const mcpPickRows = mcpMention === undefined
    ? []
    : filterMcpPresetRows(mcpPresetRows(preset => strings.output.mcpPresets[preset.descriptionKey]), mcpMention.query)
  const safeMcpIndex = clampPaletteIndex(paletteIndex, mcpPickRows)
  const mcpTokenActive = mcpMention !== undefined
  const pickingMcp = mcpTokenActive
    && !mcpDismissed
    && mcpPickRows.length > 0
  useEffect(() => {
    if (!mcpTokenActive) setMcpDismissed(false)
  }, [mcpTokenActive])

  // The `@` picker. Suppressed while any list above it is open. `/` wins
  // because it is anchored to the first character and a mention is not, which
  // makes it the more deliberate of the two.
  const mention = palette.length === 0
      && skillMention === undefined
      && permissionMention === undefined
      && modelMention === undefined
      && mcpMention === undefined
    ? mentionAt(value, cursorIndex)
    : undefined
  const files = useFileMentions(mention?.query)
  const fileRows = files.paths.map(path => ({ name: path, description: '' }))
  const safeFileIndex = clampPaletteIndex(paletteIndex, fileRows)
  const picking = mention !== undefined
    && mention.start !== dismissed
    && (fileRows.length > 0 || files.scanning)

  // The fold, the caret and the window are all derived on every render —
  // never stored. `scrollTop` is the one piece of memory, and it is only
  // *read* here; the handlers below are what move it.
  const width = textWidth > 0 ? textWidth : Math.max(1, (stdout?.columns ?? 80) - CHROME_COLUMNS)
  const rows = wrapBuffer(value, width)
  const caret = cursorAt(rows, cursorIndex)
  const start = visibleStart(rows.length, caret.row, MAX_PROMPT_ROWS, scrollTop)
  const visibleRows = rows.slice(start, start + MAX_PROMPT_ROWS)
  const scrollbar = scrollbarColumn(rows.length, MAX_PROMPT_ROWS, start)

  useEffect(() => {
    const element = textRef.current
    if (element === null) return
    const measured = measureElement(element).width
    if (measured > 0 && measured !== textWidth) setTextWidth(measured)
  })

  // ↑/↓ are shared with the log; tell the App which of us owns them.
  const claimsArrows = active
    && (palette.length > 0
      || pickingSkill
      || pickingPermission
      || pickingModel
      || pickingMcp
      || picking
      || rows.length > 1)
  useEffect(() => {
    onArrowClaimChange?.(claimsArrows)
  }, [claimsArrows, onArrowClaimChange])

  // Esc is shared with the App's turn-cancel, on the same terms.
  //
  // Vim's insert mode joins the claim, but only with something in the buffer.
  // A vim user is in insert mode almost all the time, so claiming Esc there
  // unconditionally would take turn-cancel away from them entirely; requiring
  // text means the key cancels the turn whenever there is no line to leave,
  // and a second Esc — now in normal mode, where the claim drops — cancels it
  // even when there is.
  const claimsEsc = active && (
    palette.length > 0
    || (pickingSkill && skillMention !== undefined)
    || (pickingPermission && permissionMention !== undefined)
    || (pickingModel && modelMention !== undefined)
    || (pickingMcp && mcpMention !== undefined)
    || (picking && mention !== undefined)
    || (vimOn && vim.mode === 'insert' && value !== '')
  )
  useEffect(() => {
    onEscClaimChange?.(claimsEsc)
  }, [claimsEsc, onEscClaimChange])

  // How much of the frame the floating list is taking. The banner is sized
  // against what is left, because on an empty session the two of them are the
  // only things in the frame and the banner is much the taller.
  const overlayShown = palette.length > 0
    ? Math.min(palette.length, paletteRows)
    : pickingSkill
      ? Math.min(skillPickRows.length, paletteRows)
      : pickingPermission
        ? Math.min(permissionPickRows.length, paletteRows)
        : pickingModel
          ? Math.min(modelPickRows.length, paletteRows)
          : pickingMcp
            ? Math.min(mcpPickRows.length, paletteRows)
            : picking
              ? Math.min(Math.max(fileRows.length, 1), paletteRows)
              : 0
  const overlayRows = overlayShown === 0 ? 0 : overlayShown + PALETTE_CHROME_ROWS
  useEffect(() => {
    onOverlayRowsChange?.(overlayRows)
  }, [overlayRows, onOverlayRowsChange])

  // Ctrl-U and Ctrl-C both mean something different when there is text to
  // lose. `active` is part of it: while the box is closed (a shell, an
  // approval) the prompt takes no keys at all, so a buffer left over from
  // before must not keep Ctrl-C from reaching the App.
  const filled = active && value !== ''
  useEffect(() => {
    onFilledChange?.(filled)
  }, [filled, onFilledChange])

  /**
   * Write the highlighted file into the buffer in place of the mention.
   * @returns whether there was anything to insert — `false` while the scan is
   * still running, so Tab and Enter keep their ordinary meanings until the
   * picker actually has something to offer.
   */
  const completeMention = (): boolean => {
    if (mention === undefined) return false
    const chosen = fileRows[safeFileIndex]
    if (chosen === undefined) return false
    const next = applyMention(value, mention, chosen.name)
    setValue(next.text)
    setCursorIndex(next.cursor)
    setPaletteIndex(0)
    return true
  }

  /**
   * Move the caret one row, aiming for the column the walk started in.
   *
   * The remembered column is tagged with the cursor it was computed for and
   * only honoured while the caret is still there, so every other handler
   * invalidates it by doing nothing — no `setDesired(null)` sprinkled through
   * twenty call sites, none of which can then be forgotten. The tag is sound
   * because a caret's column is decided by the text *before* it: an edit that
   * changes that text moves the index too.
   */
  const moveCaretRow = (delta: number): void => {
    const remembered = desired.current
    const aim = remembered?.cursor === cursorIndex ? remembered.column : undefined
    const move = moveVertically(rows, cursorIndex, delta, aim)
    if (move === undefined) return
    desired.current = { cursor: move.cursor, column: move.column }
    setCursorIndex(move.cursor)
    setScrollTop(visibleStart(rows.length, move.row, MAX_PROMPT_ROWS, scrollTop))
  }

  /**
   * Walk the history: `-1` towards older entries, `+1` back towards the live
   * buffer. Stepping off the newest entry restores the draft rather than
   * leaving an empty box, and stepping off the oldest does nothing at all —
   * a wall is easier to feel than a silent wrap around to the newest line.
   *
   * Edits to a recalled line are not remembered per entry. Keep walking and
   * they are gone, which is what `bash` does and is not worth another two
   * pieces of state to improve on.
   */
  const recallHistory = (delta: number): void => {
    if (history.length === 0) return
    if (historyIndex === null) {
      if (delta > 0) return
      setDraft(value)
      const index = history.length - 1
      setHistoryIndex(index)
      const recalled = history[index] ?? ''
      setValue(recalled)
      setCursorIndex(recalled.length)
      setScrollTop(0)
      return
    }
    const next = historyIndex + delta
    if (next < 0) return
    if (next >= history.length) {
      setHistoryIndex(null)
      setValue(draft)
      setCursorIndex(draft.length)
      setScrollTop(0)
      return
    }
    setHistoryIndex(next)
    const recalled = history[next] ?? ''
    setValue(recalled)
    setCursorIndex(recalled.length)
    setScrollTop(0)
  }

  /** Record a submitted line and put the prompt back on a fresh buffer. */
  const rememberSubmission = (submitted: string): void => {
    setHistory(h => pushHistory(h, submitted))
    setHistoryIndex(null)
    setDraft('')
    // A sent line puts the prompt back in insert, the way a vi-mode shell
    // does: the next thing a user does after sending is type, and making them
    // press `i` first would tax every message to make one keystroke available.
    setVim(v => (v.mode === 'normal' ? { ...v, mode: 'insert', pending: '' } : v))
  }

  /**
   * Put a line on its way and reset everything a submission owns: buffer,
   * caret, scroll, both pickers' dismiss markers, history walk and vim mode.
   * The single tail of every Enter path — palette, skill picker, plain line —
   * so a new entry point cannot quietly forget one of the resets.
   */
  const submit = (submitted: string): void => {
    setValue('')
    setCursorIndex(0)
    setScrollTop(0)
    setDismissed(null)
    setSkillDismissed(false)
    setPermissionDismissed(false)
    setModelDismissed(false)
    rememberSubmission(submitted)
    onSubmit(submitted)
  }

  /**
   * Write the highlighted skill row into the buffer in place of `/skill …`,
   * leaving the trailing space that closes the picker. Tab's answer.
   */
  const completeSkill = (): boolean => {
    if (skillMention === undefined) return false
    const chosen = skillPickRows[safeSkillIndex]
    if (chosen === undefined) return false
    const next = applySkillMention(value, skillMention, chosen.name)
    setValue(next.text)
    setCursorIndex(next.cursor)
    setPaletteIndex(0)
    return true
  }

  /**
   * Fill `/permission …` with the highlighted preset, leaving the trailing
   * space that closes the picker. Tab's answer — the line is not sent, so the
   * chosen word can be read before Enter dispatches the plugin command.
   */
  const completePermission = (): boolean => {
    if (permissionMention === undefined) return false
    const chosen = permissionPickRows[safePermissionIndex]
    if (chosen === undefined) return false
    const next = applyPermissionMention(value, permissionMention, chosen.name)
    setValue(next.text)
    setCursorIndex(next.cursor)
    setPaletteIndex(0)
    return true
  }

  /**
   * Fill `/model …` with the highlighted model, leaving the trailing space
   * that closes the picker. Tab's answer — the line is not sent, so the
   * choice can be read before Enter dispatches the switch.
   */
  const completeModel = (): boolean => {
    if (modelMention === undefined) return false
    const chosen = modelPickRows[safeModelIndex]
    if (chosen === undefined) return false
    const next = applyModelMention(value, modelMention, chosen.name)
    setValue(next.text)
    setCursorIndex(next.cursor)
    setPaletteIndex(0)
    return true
  }

  /**
   * Fill `/mcp add …` with the highlighted preset, leaving the trailing space
   * that closes the picker. Tab's answer — the line is not sent, so the choice
   * can be read before Enter writes the row.
   */
  const completeMcp = (): boolean => {
    if (mcpMention === undefined) return false
    const chosen = mcpPickRows[safeMcpIndex]
    if (chosen === undefined) return false
    const next = applyMcpMention(value, mcpMention, chosen.name)
    setValue(next.text)
    setCursorIndex(next.cursor)
    setPaletteIndex(0)
    return true
  }

  /**
   * Offer one keystroke to normal mode. Returns whether it was consumed, so
   * every call site can fall through to the ordinary editing path unchanged —
   * which is the whole design: insert mode *is* that path.
   */
  const applyVimKey = (key: { input: string; escape: boolean; return: boolean }): boolean => {
    const result = applyVim(vim, key, value, cursorIndex)
    if (!result.handled) return false
    setVim(result.state)
    if (result.text !== value) setValue(result.text)
    // `rowDelta` is `j`/`k`, the one pair whose destination depends on the
    // measured width — so the component answers it with the same row mover
    // the arrow keys use, and ignores the index the engine reported.
    if (result.rowDelta !== undefined) moveCaretRow(result.rowDelta)
    else setCursorIndex(result.cursor)
    return true
  }

  // Ink's raw mode hides the terminal cursor, so we render our own.
  // Keep it stable instead of blinking: the prompt is already visually
  // distinct while active, and a 500ms re-render loop is unnecessary churn
  // on a terminal UI that has to stay smooth while scrolling the log.
  useInput(
    (input, key) => {
      // Spontaneous terminal reports (OSC sequences whose leading ESC Ink's
      // key parser peeled off as a lone Escape key) must never be typed into
      // the buffer. The VS Code integrated terminal is known to send these
      // unsolicited, and the background-colour probe during boot can also
      // leave a tail if the terminal answers more than once.
      if (isOscTail(input)) return
      // Paste decoding comes first, ahead of every key branch. Inside a
      // bracketed paste Ink has already labelled some bytes `return`, `tab`
      // or `backspace` — a pasted newline is the same byte as Enter — so any
      // dispatch that ran before this point would act on a keystroke the user
      // never made. See `src/prompt/paste.ts`.
      const paste = readPaste(input, pasting.current)
      if (paste.bracketed) {
        pasting.current = paste.open
        if (paste.text !== '') {
          setValue((current) => {
            const next = insertTextAtCursor(current, cursorIndex, paste.text)
            setCursorIndex(cursorIndex + paste.text.length)
            return next
          })
        }
        return
      }
      // `Ctrl-` keystrokes are split with the layers above us, per the
      // ownership table in SPEC §1.6: we take the caret ends and the
      // deletions, and Ctrl-B/F/D (log scroll) pass straight through. What
      // must never happen is falling through to the text path below, where
      // Ink delivers a `Ctrl-` keystroke as its bare letter — so Ctrl-C would
      // append a 'c' to the buffer on its way out.
      //
      // Ctrl-U and Ctrl-C are *conditional* members of that split, and the
      // condition is the same one: whether there is text to lose. Both report
      // upward through `onFilledChange`, and the layer that would otherwise
      // act (the log for Ctrl-U, the App for Ctrl-C) stands down for exactly
      // as long as the buffer is non-empty. An empty buffer gives them back,
      // so neither key becomes unreachable.
      //
      // Ctrl-J is not handled here and does not need to be: Ink parses it
      // as the linefeed it is, so it arrives as ordinary input '\n'.
      if (key.ctrl) {
        if (input === 'a') setCursorIndex(0)
        else if (input === 'e') setCursorIndex(value.length)
        else if (input === 'w') {
          const next = deleteWordBefore(value, cursorIndex)
          setValue(next.text)
          setCursorIndex(next.cursor)
        } else if (input === 'k') setValue(deleteToEnd(value, cursorIndex))
        else if (input === 'u' && value !== '') {
          setValue(deleteToStart(value, cursorIndex))
          setCursorIndex(0)
        } else if (input === 'c' && value !== '' && !busy) {
          // Abandon the line, stay in the app. The App's exit path checks the
          // same emptiness through `onFilledChange`, so exactly one of us acts.
          // While a turn runs the App's branch outranks this one — the press
          // means "stop the model", and eating the line as well would answer
          // one keystroke twice.
          setValue('')
          setCursorIndex(0)
          setHistoryIndex(null)
        } else if (input === 'p') recallHistory(-1)
        else if (input === 'n') recallHistory(1)
        return
      }
      // Mouse reports reach every `useInput` handler as ordinary input
      // with the leading ESC stripped, so without this a spin of the
      // wheel types `[<64;12;30M` into the prompt. The scroll hook is
      // what acts on them; here they are simply not text.
      if (isMouseReport(input)) return
      // Esc — when the palette is open, dismiss it by clearing the
      // buffer. When the palette is closed, leave the buffer alone
      // (Esc has no other meaning in the prompt).
      if (key.escape) {
        if (palette.length > 0) {
          setValue('')
          setCursorIndex(0)
          setPaletteIndex(0)
          setScrollTop(0)
        } else if (pickingSkill && skillMention !== undefined) {
          // Same bargain as the file picker: dismiss the list for this token,
          // keep the `/skill rev` the user has typed.
          setSkillDismissed(true)
          setPaletteIndex(0)
        } else if (pickingPermission && permissionMention !== undefined) {
          // Dismiss once, keep `/permission dan` on screen.
          setPermissionDismissed(true)
          setPaletteIndex(0)
        } else if (pickingModel && modelMention !== undefined) {
          // Dismiss once, keep `/model deep` on screen.
          setModelDismissed(true)
          setPaletteIndex(0)
        } else if (pickingMcp && mcpMention !== undefined) {
          // Dismiss once, keep `/mcp add mem` on screen.
          setMcpDismissed(true)
          setPaletteIndex(0)
        } else if (picking && mention !== undefined) {
          // The buffer is a sentence the user is writing, not a command they
          // mistyped: dismiss the list, keep the words.
          setDismissed(mention.start)
          setPaletteIndex(0)
        } else if (vimOn && applyVimKey({ input: '', escape: true, return: false })) {
          // Leaving insert mode, or cancelling a half-typed operator. The
          // visible list wins the key ahead of both, because a list on screen
          // is what Esc means everywhere else in this prompt.
          return
        }
        return
      }
      // `Alt-`/`Option-` word motions. Ink reports these as the bare letter
      // with `key.meta`, because that is what the terminal sends: ESC then
      // the letter. That also means a lone Esc arrives with `key.meta` set,
      // so this branch has to sit *below* the Esc handling above — above it,
      // Esc would return here and never reach the palette.
      if (key.meta) {
        if (input === 'b') setCursorIndex(wordStartBefore(value, cursorIndex))
        else if (input === 'f') setCursorIndex(wordEndAfter(value, cursorIndex))
        return
      }
      // Tab — complete the highlighted command. The cursor lands
      // after a trailing space so the user can keep typing arguments
      // without an extra keystroke.
      if (key.tab && palette.length > 0) {
        const chosen = palette[safePaletteIndex]
        if (chosen) {
          const completed = `${chosen.name} `
          setValue(completed)
          setCursorIndex(completed.length)
          setPaletteIndex(0)
        }
        return
      }
      // Tab in the skill picker inserts `/<name> ` so arguments can follow.
      if (key.tab && pickingSkill) {
        completeSkill()
        return
      }
      // Tab in the preset picker fills `/permission <value> ` without sending.
      if (key.tab && pickingPermission) {
        completePermission()
        return
      }
      // Tab in the model picker fills `/model <id> ` without sending.
      if (key.tab && pickingModel) {
        completeModel()
        return
      }
      // Tab in the preset picker fills `/mcp add <name> ` without sending.
      if (key.tab && pickingMcp) {
        completeMcp()
        return
      }
      // Tab in a mention inserts the highlighted path. Same keystroke, same
      // meaning: finish what I have started typing.
      if (key.tab && picking) {
        completeMention()
        return
      }
      // Tab / Shift+Tab on an empty buffer, with no list floating: cycle the
      // permission preset, forward and back. Sitting below every completion
      // branch above is the whole eligibility rule — an open list outranks the
      // cycle, and so does any text in the buffer (where Tab is an editing
      // key, not a shortcut). The guards on the lists are technically implied
      // by `value === ''` (every one of them anchors on a non-empty prefix);
      // they are spelled out so a future list that does not will inherit the
      // right precedence for free.
      if (
        key.tab
        && value === ''
        && onCyclePermission !== undefined
        && palette.length === 0
        && !pickingSkill
        && !pickingPermission
        && !pickingModel
        && !pickingMcp
        && !picking
      ) {
        onCyclePermission(key.shift ? -1 : 1)
        return
      }
      // ↑/↓ — the palette first, then row movement inside a buffer that
      // occupies more than one row. On a single row they are the log's
      // (see `claimsArrows`), so bail and let the scroll hook have them.
      if (key.upArrow) {
        if (palette.length > 0) {
          setPaletteIndex(i => clampPaletteIndex(i - 1, palette))
          return
        }
        if (pickingSkill) {
          setPaletteIndex(i => clampPaletteIndex(i - 1, skillPickRows))
          return
        }
        if (pickingPermission) {
          setPaletteIndex(i => clampPaletteIndex(i - 1, permissionPickRows))
          return
        }
        if (pickingModel) {
          setPaletteIndex(i => clampPaletteIndex(i - 1, modelPickRows))
          return
        }
        if (pickingMcp) {
          setPaletteIndex(i => clampPaletteIndex(i - 1, mcpPickRows))
          return
        }
        if (picking) {
          setPaletteIndex(i => clampPaletteIndex(i - 1, fileRows))
          return
        }
        if (rows.length > 1) moveCaretRow(-1)
        return
      }
      if (key.downArrow) {
        if (palette.length > 0) {
          setPaletteIndex(i => clampPaletteIndex(i + 1, palette))
          return
        }
        if (pickingSkill) {
          setPaletteIndex(i => clampPaletteIndex(i + 1, skillPickRows))
          return
        }
        if (pickingPermission) {
          setPaletteIndex(i => clampPaletteIndex(i + 1, permissionPickRows))
          return
        }
        if (pickingModel) {
          setPaletteIndex(i => clampPaletteIndex(i + 1, modelPickRows))
          return
        }
        if (pickingMcp) {
          setPaletteIndex(i => clampPaletteIndex(i + 1, mcpPickRows))
          return
        }
        if (picking) {
          setPaletteIndex(i => clampPaletteIndex(i + 1, fileRows))
          return
        }
        if (rows.length > 1) moveCaretRow(1)
        return
      }
      // Normal mode, below every key the palette and the picker claim and
      // above the text path. Ordering is the whole safety argument: a letter
      // that reached the text path in normal mode would type the command the
      // user meant to run, and a modal editor that sometimes types its own
      // commands is worse than none.
      //
      // Backspace arrives as `h`. Ink reports it with an empty `input`, and in
      // normal mode the vi answer is to move left — deleting instead would be
      // the one destructive key nobody pressed on purpose.
      if (normalMode) {
        const vimInput = key.backspace || key.delete ? 'h' : paste.text
        if (applyVimKey({ input: vimInput, escape: false, return: key.return })) return
      }
      if (key.return) {
        if (value.endsWith('\\')) {
          const next = `${value.slice(0, -1)}\n`
          setValue(next)
          setCursorIndex(next.length)
          return
        }
        // Palette open with an exact match — run it. We compare
        // against the registry's `name` so case is normalized.
        if (palette.length > 0) {
          const normalized = value.toLowerCase()
          // The one exact match that must not run: a bare `/skill` only
          // prints usage, while the row's whole job is to open the picker.
          // Completing to `/skill ` does that on the next render.
          if (normalized === '/skill') {
            setValue('/skill ')
            setCursorIndex(8)
            setPaletteIndex(0)
            return
          }
          // Same bargain for `/permission`, but only when this build has
          // advertised presets to pick: with no projection mounted, the bare
          // command belongs to the plugin, whose own usage answer must run.
          if (normalized === '/permission' && (permissionCommands?.length ?? 0) > 0) {
            setValue(PERMISSION_PREFIX)
            setCursorIndex(PERMISSION_PREFIX.length)
            setPaletteIndex(0)
            return
          }
          // Same, for `/model`, and for the same reason: with a catalogue in
          // hand the picker is what the key was reaching for; without one the
          // bare command's usage answer must still run.
          if (normalized === '/model' && (modelCommands?.length ?? 0) > 0) {
            setValue(MODEL_PREFIX)
            setCursorIndex(MODEL_PREFIX.length)
            setPaletteIndex(0)
            return
          }
          const exact = palette.find(c => c.name === normalized)
          if (exact) {
            submit(exact.name)
            return
          }
          // Otherwise, complete the highlighted name into the buffer
          // so the user can keep editing without losing context.
          const chosen = palette[safePaletteIndex]
          if (chosen) {
            const completed = `${chosen.name} `
            setValue(completed)
            setCursorIndex(completed.length)
            setPaletteIndex(0)
          }
          return
        }
        // Enter in the skill picker RUNS the highlighted skill — unlike the
        // file picker, whose rows are prose and only get inserted. The chosen
        // name is submitted bare; Tab is the path for adding arguments first.
        if (pickingSkill) {
          const chosen = skillPickRows[safeSkillIndex]
          if (chosen) {
            submit(chosen.name)
            return
          }
        }
        // Enter in the preset picker SWITCHES: submit the full line to the
        // plugin command. Tab is the path for reviewing the completed line
        // first; a second Enter sends nothing the picker did not already name.
        if (pickingPermission) {
          const chosen = permissionPickRows[safePermissionIndex]
          if (chosen) {
            submit(permissionCommandLine(chosen.name))
            return
          }
        }
        // Enter in the model picker SWITCHES: submit `/model <id>` through the
        // ordinary dispatch, so the switch keeps its echo, its validation and
        // its busy-check. Tab is the path for reviewing the completed line.
        if (pickingModel) {
          const chosen = modelPickRows[safeModelIndex]
          if (chosen) {
            submit(modelCommandLine(chosen.name))
            return
          }
        }
        // Enter in the preset picker WRITES: submit `/mcp add <name>` through
        // the ordinary dispatch, so the row keeps its duplicate check, its
        // connect-wait and its report. Tab is the path for reviewing first.
        if (pickingMcp) {
          const chosen = mcpPickRows[safeMcpIndex]
          if (chosen) {
            submit(mcpPresetCommandLine(chosen.name))
            return
          }
        }
        // `/mcp add` with no payload opens the picker — the same bargain
        // `/skill` makes, except the catalog is static so it always has rows.
        // The guard keeps an Esc-dismissed picker dismissed: the second Enter
        // then submits and the dispatch's usage answer — which is where the
        // paste path is documented — reaches the transcript.
        if (value.trim().toLowerCase() === '/mcp add' && !(mcpTokenActive && mcpDismissed)) {
          setValue(MCP_ADD_PREFIX)
          setCursorIndex(MCP_ADD_PREFIX.length)
          setPaletteIndex(0)
          return
        }
        // Enter in an open file picker inserts the path rather than sending
        // the line, matching the `/` palette above: the visible list is what
        // the key acts on. Sending takes a second Enter, by which time the
        // picker is closed.
        if (picking && completeMention()) return
        submit(value)
        return
      }
      if (key.leftArrow) {
        setCursorIndex(i => Math.max(0, i - 1))
        return
      }
      if (key.rightArrow) {
        setCursorIndex(i => Math.min(value.length, i + 1))
        return
      }
      if (key.backspace || key.delete) {
        setValue((current) => {
          const nextCursor = Math.max(0, cursorIndex - 1)
          const nextValue = removeCharBeforeCursor(current, cursorIndex)
          setCursorIndex(nextCursor)
          return nextValue
        })
        return
      }
      // `paste.text`, not `input`: a terminal that ignores `?2004` still
      // delivers a multi-line paste as one unbracketed chunk full of `\r`,
      // and those have to become `\n` before they reach a buffer whose
      // wrapper only breaks on `\n`. A real Enter never arrives here — Ink
      // reports it as `key.return`, handled above.
      if (paste.text) {
        setValue((current) => {
          const nextValue = insertTextAtCursor(current, cursorIndex, paste.text)
          setCursorIndex(cursorIndex + paste.text.length)
          return nextValue
        })
      }
    },
    { isActive: active },
  )

  // The running placeholder is the same spinner glyph the StatusBar
  // uses, so the two indicators stay in lock-step. Both come from
  // the App's single `useRunningClock` interval; idle placeholder
  // is unchanged.
  //
  // A running turn no longer implies a dead prompt, so the spinner has two
  // captions. It says `working` when the box really is closed (a shell, an
  // approval) and `steering` when the turn is running but the line is still
  // live — the caption is the only thing telling the user which of the two
  // Enter is about to do.
  const placeholder = !busy
    ? strings.prompt.placeholder
    : `${SPINNER_FRAMES[spinnerFrame]} ${active ? strings.prompt.steering : strings.prompt.working}`
  // Two cues for normal mode, both free: the caret and the buffer marker turn
  // yellow. Neither costs a row and neither changes the box's width, which
  // rules out the two obvious alternatives — a mode line under the box would
  // grow the frame every time you pressed Esc, and a wider `NORMAL` prefix
  // would re-fold every wrapped row on the same keystroke.
  const modeColor = normalMode ? 'yellow' : 'cyan'
  const cursor = active ? (
    <Text color={modeColor} bold>
      ▌
    </Text>
  ) : null

  return (
    <Box flexDirection="column">
      {palette.length > 0 ? (
        <Box marginBottom={1}>
          <SlashPalette commands={palette} selected={safePaletteIndex} maxRows={paletteRows} />
        </Box>
      ) : null}
      {pickingSkill ? (
        <Box marginBottom={1}>
          <SlashPalette
            commands={skillPickRows}
            selected={safeSkillIndex}
            hint={strings.palette.skillHint}
            maxRows={paletteRows}
          />
        </Box>
      ) : null}
      {pickingPermission ? (
        <Box marginBottom={1}>
          <SlashPalette
            commands={permissionPickRows}
            selected={safePermissionIndex}
            hint={strings.palette.permissionHint}
            maxRows={paletteRows}
          />
        </Box>
      ) : null}
      {pickingModel ? (
        <Box marginBottom={1}>
          <SlashPalette
            commands={modelPickRows}
            selected={safeModelIndex}
            hint={strings.palette.modelHint}
            maxRows={paletteRows}
          />
        </Box>
      ) : null}
      {pickingMcp ? (
        <Box marginBottom={1}>
          <SlashPalette
            commands={mcpPickRows}
            selected={safeMcpIndex}
            hint={strings.palette.mcpHint}
            maxRows={paletteRows}
          />
        </Box>
      ) : null}
      {picking ? (
        <Box marginBottom={1}>
          <SlashPalette
            commands={fileRows.length > 0
              ? fileRows
              : [{ name: strings.palette.scanning, description: '' }]}
            selected={fileRows.length > 0 ? safeFileIndex : -1}
            hint={strings.palette.fileHint}
            maxRows={paletteRows}
          />
        </Box>
      ) : null}
      <Box borderStyle="round" borderColor={active ? 'cyan' : 'gray'} paddingX={1}>
        {/*
          The `> ` prefix marks the *start of the buffer*, so it is drawn
          only on absolute row 0. Painting it on whatever row happens to be
          at the top after scrolling would claim the buffer starts there.
        */}
        <Box flexDirection="column" flexShrink={0}>
          {visibleRows.map((_row, index) => (
            <Text key={`prefix-${start + index}`} color={modeColor} bold>
              {start + index === 0 ? (normalMode ? 'N ' : '> ') : '  '}
            </Text>
          ))}
        </Box>
        <Box ref={textRef} flexDirection="column" flexGrow={1} flexShrink={1}>
          {value === '' ? (
            <Text wrap="truncate">
              {cursor}
              <Text color="gray" dimColor>
                {placeholder}
              </Text>
            </Text>
          ) : (
            visibleRows.map((row, index) => {
              const absolute = start + index
              // Every row is pre-folded to the measured width, so
              // `truncate` should never fire. It is here because the
              // failure it prevents — a row Ink re-wraps, growing the box
              // past its cap — is far worse than a clipped tail.
              if (absolute !== caret.row) {
                return (
                  <Text key={absolute} wrap="truncate">
                    {row.text}
                  </Text>
                )
              }
              return (
                <Text key={absolute} wrap="truncate">
                  {row.text.slice(0, caret.offset)}
                  {cursor}
                  {row.text.slice(caret.offset)}
                </Text>
              )
            })
          )}
        </Box>
        {/*
          Reserved unconditionally, blanks included: a bar that appeared
          only on overflow would narrow the text at that moment and re-fold
          every row under the caret. Same reasoning as the message list's
          reserved hint row.
        */}
        <Box flexDirection="column" flexShrink={0}>
          {scrollbar.map((glyph, index) => (
            <Text key={`bar-${start + index}`} color="cyan" dimColor>
              {glyph}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
