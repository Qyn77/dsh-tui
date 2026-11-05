import { openImagePreview } from '../image-preview.ts'
import { readBuildIdentity } from '../build-identity.ts'
import type { EventEmitter } from 'node:events'
import type { Key } from 'ink'
import { imageHelper, pasteClipboardImage, type ImageHelper, type ClipboardImageResult } from '../../attachments/clipboard-image.ts'
import { osc52 } from '../../commands/clipboard.ts'
import type { MousePreference } from '../mouse.ts'
import type { NotificationMode } from '../notifications.ts'
import { liveFrameHeight } from '../geometry.ts'
import { probeAppearance, type ProbeOptions } from '../theme.ts'
import { detectTerminal } from './profiles.ts'
import { createTerminalModes, interactionMode, VT } from './modes.ts'
import { TerminalInputDecoder, type TerminalEvent } from './input.ts'

export interface TerminalOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  write?: (text: string) => unknown
  mouse?: MousePreference
  readImage?: (helper: ImageHelper) => Promise<ClipboardImageResult>
}

/** Factory composes one emulator profile with host and transport backends. */
export function createTerminalService(options: TerminalOptions = {}) {
  const env = { ...(options.env ?? process.env) }
  const platform = options.platform ?? process.platform
  const environment = detectTerminal(env, platform)
  const modes = createTerminalModes(options.write ?? (() => {}), environment, options.mouse)
  const decoder = new TerminalInputDecoder()
  const listeners = new Set<(event: TerminalEvent) => void>()
  const observed = { pointer: false, paste: false, report: false }
  let detach: (() => void) | undefined
  let escapeTimer: ReturnType<typeof setTimeout> | undefined
  let suspended = false
  let disposed = false
  const clearInput = () => { clearTimeout(escapeTimer); escapeTimer = undefined; decoder.reset() }
  const publish = (events: TerminalEvent[]) => {
    for (const event of events) {
      if (event.kind === 'pointer') observed.pointer = true
      if (event.kind === 'paste-start') observed.paste = true
      if (event.kind === 'report') observed.report = true
      for (const listener of [...listeners]) listener(event)
    }
  }
  const accept = (chunk: Buffer | string) => {
    if (suspended) return
    clearTimeout(escapeTimer)
    publish(decoder.feed(chunk))
    if (decoder.awaitingEscape) {
      escapeTimer = setTimeout(() => { publish(decoder.flushEscape()) }, 25)
      escapeTimer.unref?.()
    }
  }
  return {
    environment,
    previewImage: (path: string) => openImagePreview(platform, !environment.remote && !environment.wsl && environment.multiplexer === 'none', path),
    modes,
    frameHeight: liveFrameHeight,
    clearSequence: VT.clear,
    mode: (preference: MousePreference) => interactionMode(environment, preference),
    detectAppearance: (options: Omit<ProbeOptions, 'colorFgBg'>) => probeAppearance({ ...options, colorFgBg: env['COLORFGBG'] }),
    subscribe(listener: (event: TerminalEvent) => void) {
      if (!disposed) listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Only the Ink bridge attaches; never add a flowing data reader to real stdin. */
    attach(events: EventEmitter) {
      if (disposed) throw new Error('Terminal service disposed')
      if (detach) throw new Error('Terminal input already attached')
      events.on('input', accept)
      const release = () => { events.off('input', accept); clearInput(); if (detach === release) detach = undefined }
      detach = release
      return release
    },
    suspend() { suspended = true; clearInput(); modes.suspend() },
    resume() { if (disposed) return; modes.enter(); suspended = false },
    dispose() { disposed = true; suspended = true; detach?.(); clearInput(); listeners.clear(); modes.dispose() },
    isImageShortcut(input: string, key: Pick<Key, 'ctrl' | 'meta'>) {
      return input.toLowerCase() === 'v' && (key.ctrl || (key.meta && environment.profile.forwardedMetaV))
    },
    importOnEmptyPaste: environment.profile.emptyPasteImage && !environment.remote,
    async readClipboardImage(this: void): Promise<ClipboardImageResult> {
      if (environment.clipboard === 'unavailable') return { kind: 'unavailable' }
      const host = environment.clipboard === 'windows' ? 'win32' : platform
      const helper = imageHelper(host, env)
      if (!helper) return { kind: 'unavailable' }
      return options.readImage ? options.readImage(helper) : pasteClipboardImage(undefined, helper)
    },
    encodeClipboardText(this: void, text: string): string {
      // GNU screen passthrough is not implemented; never print an unsupported payload.
      if (environment.multiplexer === 'screen') return ''
      return osc52(text, { multiplexer: environment.multiplexer === 'tmux' ? 'tmux' : undefined })
    },
    notification(mode: NotificationMode, title: string): string {
      if (mode === 'off') return ''
      if (mode !== 'desktop' || environment.profile.desktopNotification !== 'osc9' || environment.multiplexer !== 'none') return '\u0007'
      const safe = title.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 160)
      return `\u001b]9;${safe}\u0007`
    },
    diagnostics(this: void) {
      return { build: readBuildIdentity(), adapter: environment.profile.id, evidence: environment.evidence,
        invalidOverride: environment.invalidOverride, platform: environment.platform,
        remote: environment.remote, wsl: environment.wsl, multiplexer: environment.multiplexer,
        clipboardHost: environment.clipboard, pointerSupport: environment.profile.pointer,
        requestedMode: modes.active ? modes.mode : 'inactive', observed: { ...observed },
        keyboard: 'legacy-vt', emptyPasteImage: environment.profile.emptyPasteImage && !environment.remote }
    },
  }
}
export type TerminalService = ReturnType<typeof createTerminalService>
