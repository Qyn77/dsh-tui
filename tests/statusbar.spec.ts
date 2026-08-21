/**
 * Tests for the StatusBar's column-aware model-name fitter. The
 * StatusBar itself mounts through Ink and is covered by a manual
 * smoke (`pnpm dsh --profile tui` in a real TTY); here we lock the
 * pure helper that decides how `provider/model` shrinks when the
 * terminal is too narrow to hold it.
 */

import { describe, expect, it } from 'vitest'
import { fitModelName } from '../src/components/StatusBar.tsx'

describe('fitModelName', () => {
  it('returns the full `provider/model` when it fits', () => {
    expect(fitModelName('dsh', 'v4', 20)).toBe('dsh/v4')
  })

  it('returns the full string unchanged when exactly at the width', () => {
    // `dsh/v4` is 6 chars; at maxWidth 6 it must still be returned
    // untouched (boundary case — using `≤` not `<`).
    expect(fitModelName('dsh', 'v4', 6)).toBe('dsh/v4')
  })

  it('drops the provider when the model alone fits', () => {
    // provider takes 16 chars, model 31 chars, total 48.
    // At maxWidth 35 the full form does not fit, but the model does.
    expect(
      fitModelName('deepseek-official', 'deepseek-v4-session:tui-b1-flash', 35),
    ).toBe('deepseek-v4-session:tui-b1-flash')
  })

  it('keeps the tail and prepends `…` when neither the full form nor the bare model fits', () => {
    // Model is 31 chars; at maxWidth 20 we must show the last 19
    // characters with a leading ellipsis so the user still sees
    // `:tui-b1-flash` (the variant tag they actually picked).
    expect(
      fitModelName('deepseek-official', 'deepseek-v4-session:tui-b1-flash', 20),
    ).toBe('…ession:tui-b1-flash')
  })

  it('falls back to the very tail when the budget is tiny', () => {
    expect(
      fitModelName('p', 'a-very-long-model-name', 10),
    ).toBe('…odel-name')
  })

  it('returns an empty string for non-positive widths', () => {
    expect(fitModelName('p', 'm', 0)).toBe('')
    expect(fitModelName('p', 'm', -3)).toBe('')
  })

  it('prefers the bare model over `…` even at very small widths', () => {
    // A 1-char model is more useful than a lone `…`: the user at
    // least sees the name. The function only emits `…` when even
    // the bare model does not fit.
    expect(fitModelName('p', 'm', 1)).toBe('m')
  })

  it('emits a lone `…` only when the model itself does not fit', () => {
    expect(fitModelName('p', 'mm', 1)).toBe('…')
  })
})
