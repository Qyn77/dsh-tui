import { StringDecoder } from 'node:string_decoder'
import type { Key } from 'ink'
import { parseMouseEvents, type MouseEvent } from '../mouse.ts'

export type TerminalEvent =
  | { kind: 'key'; input: string; key: Key }
  | { kind: 'pointer'; event: MouseEvent }
  | { kind: 'navigation'; key: 'home' | 'end' }
  | { kind: 'interaction-toggle' }
  | { kind: 'paste-start' }
  | { kind: 'paste-text'; text: string }
  | { kind: 'paste-end'; empty: boolean }
  | { kind: 'report' }

const ESC = '\u001b'
const START = `${ESC}[200~`
const END = `${ESC}[201~`
export function keyFlags(flags: Partial<Key> = {}): Key {
  return { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageDown: false, pageUp: false, return: false, escape: false, ctrl: false,
    shift: false, tab: false, backspace: false, delete: false, meta: false, ...flags }
}

/** Legacy VT keys only. Never negotiate a keyboard protocol we cannot decode. */
function keyEvent(sequence: string): TerminalEvent {
  const nav = /^(?:\u001b\[(?:H|[17]~)|\u001bOH)$/.test(sequence) ? 'home'
    : /^(?:\u001b\[(?:F|[48]~)|\u001bOF)$/.test(sequence) ? 'end' : undefined
  if (nav) return { kind: 'navigation', key: nav }
  if (sequence === `${ESC}[12~` || sequence === `${ESC}OQ`) return { kind: 'interaction-toggle' }
  const control = sequence.charCodeAt(0)
  if (sequence === ESC || sequence === ESC + ESC) return { kind: 'key', input: '', key: keyFlags({ escape: true, meta: true }) }
  if (sequence === '\n') return { kind: 'key', input: '\n', key: keyFlags() }
  if (sequence === '\r') return { kind: 'key', input: '', key: keyFlags({ return: true }) }
  if (sequence === '\t') return { kind: 'key', input: '', key: keyFlags({ tab: true }) }
  if (sequence === '\u007f' || sequence === '\b') return { kind: 'key', input: '', key: keyFlags({ backspace: true }) }
  if (sequence.length === 1 && control >= 0 && control < 32) {
    return { kind: 'key', input: String.fromCharCode(control + 64).toLowerCase(), key: keyFlags({ ctrl: true }) }
  }
  const arrow = /^\u001b(?:\[|O)(?:1;([2-8]))?([ABCDHFZ])$/.exec(sequence)
  const numbered = /^\u001b\[(\d+)(?:;([2-8]))?~$/.exec(sequence)
  if (arrow || numbered) {
    const modifier = Number(arrow?.[1] ?? numbered?.[2] ?? 1) - 1
    const key = keyFlags({ shift: (modifier & 1) !== 0, meta: (modifier & 2) !== 0, ctrl: (modifier & 4) !== 0 })
    const arrows: Partial<Record<string, keyof Key>> = { A: 'upArrow', B: 'downArrow', C: 'rightArrow', D: 'leftArrow', Z: 'tab' }
    const numbers: Partial<Record<string, keyof Key>> = { '3': 'delete', '5': 'pageUp', '6': 'pageDown' }
    const flag = arrow ? arrows[arrow[2]] : numbers[numbered?.[1] ?? '']
    if (flag) { key[flag] = true; if (arrow?.[2] === 'Z') key.shift = true; return { kind: 'key', input: '', key } }
    return { kind: 'report' }
  }
  if (sequence === `${ESC}\u007f` || sequence === `${ESC}\b`) {
    return { kind: 'key', input: '', key: keyFlags({ backspace: true, meta: true }) }
  }
  if (sequence.startsWith(ESC) && !sequence.startsWith(`${ESC}[`) && !sequence.startsWith(`${ESC}O`)) {
    return { kind: 'key', input: sequence.slice(1), key: keyFlags({ meta: true, shift: /^[A-Z]$/.test(sequence.slice(1)) }) }
  }
  if (sequence.startsWith(ESC)) return { kind: 'report' }
  return { kind: 'key', input: sequence.replaceAll('\r\n', '\n').replaceAll('\r', '\n'), key: keyFlags({ shift: /^[A-Z]$/.test(sequence) }) }
}

/** Incremental decoder. Paste is streamed; only a short marker suffix is buffered. */
export class TerminalInputDecoder {
  private utf8 = new StringDecoder('utf8')
  private pending = ''
  private pasting = false
  private pasteHasText = false
  private previousCR = false
  private discard: 'osc' | 'string' | 'csi' | undefined

  get awaitingEscape(): boolean { return this.pending === ESC && !this.pasting && !this.discard }

  reset(): void {
    this.utf8 = new StringDecoder('utf8')
    this.pending = ''; this.pasting = false; this.pasteHasText = false; this.previousCR = false; this.discard = undefined
  }

  flushEscape(): TerminalEvent[] {
    if (!this.awaitingEscape) return []
    this.pending = ''
    return [keyEvent(ESC)]
  }

  feed(chunk: Buffer | string): TerminalEvent[] {
    this.pending += typeof chunk === 'string' ? chunk : this.utf8.write(chunk)
    const events: TerminalEvent[] = []
    const pasteText = (raw: string) => {
      if (!raw) return
      this.pasteHasText = true
      const text = (this.previousCR && raw.startsWith('\n') ? raw.slice(1) : raw)
        .replaceAll('\r\n', '\n').replaceAll('\r', '\n')
      this.previousCR = raw.endsWith('\r')
      if (text) events.push({ kind: 'paste-text', text })
    }
    while (this.pending) {
      if (this.discard) {
        const match = (this.discard === 'osc' ? /\u0007|\u001b\\/
          : this.discard === 'string' ? /\u001b\\/ : /[\x40-\x7e]/).exec(this.pending)
        if (!match) { this.pending = this.pending.endsWith(ESC) ? ESC : ''; break }
        this.pending = this.pending.slice(match.index + match[0].length); this.discard = undefined
        events.push({ kind: 'report' }); continue
      }
      if (this.pasting) {
        const end = this.pending.indexOf(END)
        if (end >= 0) {
          const text = this.pending.slice(0, end)
          pasteText(text)
          events.push({ kind: 'paste-end', empty: !this.pasteHasText })
          this.pasting = false; this.pending = this.pending.slice(end + END.length); continue
        }
        let suffix = Math.min(this.pending.length, END.length - 1)
        while (suffix > 0 && !END.startsWith(this.pending.slice(-suffix))) suffix--
        const text = this.pending.slice(0, this.pending.length - suffix)
        pasteText(text)
        this.pending = suffix ? this.pending.slice(-suffix) : ''; break
      }
      if (this.pending.startsWith(START)) {
        this.pending = this.pending.slice(START.length); this.pasting = true; this.pasteHasText = false; this.previousCR = false
        events.push({ kind: 'paste-start' }); continue
      }
      if (this.pending[0] !== ESC) {
        // Preserve multiline unbracketed paste, but split non-whitespace control
        // keys even when the OS coalesces several keystrokes into one read.
        const next = this.pending.search(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/)
        const text = next < 0 ? this.pending : this.pending.slice(0, Math.max(1, next))
        events.push(keyEvent(text)); this.pending = this.pending.slice(text.length); continue
      }
      if (this.pending.length === 1) break
      if ([']', 'P', '_', '^', 'X'].includes(this.pending[1])) {
        // OSC permits BEL; DCS/APC/PM/SOS require ST, including after overflow.
        const osc = this.pending[1] === ']'
        const end = (osc ? /\u0007|\u001b\\/ : /\u001b\\/).exec(this.pending.slice(2))
        if (!end) {
          if (this.pending.length > 4096) { this.discard = osc ? 'osc' : 'string'; this.pending = this.pending.endsWith(ESC) ? ESC : '' }
          break
        }
        this.pending = this.pending.slice(2 + end.index + end[0].length)
        events.push({ kind: 'report' }); continue
      }
      let length = 2
      if (this.pending.startsWith(`${ESC}[M`)) {
        if (this.pending.length < 6) break
        length = 6
      } else if (this.pending[1] === '[' || this.pending[1] === 'O') {
        const final = /[\x40-\x7e]/.exec(this.pending.slice(2))
        if (!final) {
          if (this.pending.length > 128) { this.discard = 'csi'; this.pending = '' }
          break
        }
        length = final.index + 3
      }
      const sequence = this.pending.slice(0, length)
      this.pending = this.pending.slice(length)
      const mouse = parseMouseEvents(sequence)
      if (mouse.length) events.push(...mouse.map(event => ({ kind: 'pointer' as const, event })))
      else events.push(keyEvent(sequence))
    }
    return events
  }
}
