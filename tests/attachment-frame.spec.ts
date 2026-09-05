/**
 * How an attached image looks in the transcript.
 *
 * The chip is the only confirmation the user gets that the right file went with
 * their words — nothing renders the raster — so what it says and where it sits
 * are both pinned here. Its height is pinned too, in `scroll.spec.ts`: a chip
 * row that `estimateEntryRows` does not predict makes paging non-invertible,
 * which is the failure this repo has already paid for once.
 * @module @deepseek-ai/dsh-tui/tests/attachment-frame.spec
 */

import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { paintApp } from './fake-tty.ts'

function ref(over: Partial<ImageAttachmentRef> = {}): ImageAttachmentRef {
  return {
    attachmentId: 'att-1' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 284_000,
    width: 1_440,
    height: 900,
    name: 'shot.png',
    ...over,
  }
}

/** Append a user message carrying `images` ahead of `text`. */
async function withImages(
  painted: Awaited<ReturnType<typeof paintApp>>,
  images: readonly ImageAttachmentRef[],
  text?: string,
) {
  await painted.append('user/message', createUserMessage({
    content: [
      ...images.map(attachment => ({ type: 'image' as const, attachment })),
      ...(text === undefined ? [] : [{ type: 'text' as const, text }]),
    ],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

describe('an attached image', () => {
  it('names the file, its pixel size, and its byte size', async () => {
    const painted = await paintApp({ rows: 40 })
    await withImages(painted, [ref()], 'what is wrong here')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('shot.png · 1440×900 · 284 KB')
  })

  it('sits inside the user frame, above the text', async () => {
    const painted = await paintApp({ rows: 40 })
    await withImages(painted, [ref()], 'what is wrong here')
    const rows = painted.screen().split('\n')
    painted.unmount()

    const chip = rows.findIndex(r => r.includes('shot.png'))
    const text = rows.findIndex(r => r.includes('what is wrong here'))
    expect(chip).toBeGreaterThanOrEqual(0)
    // Above the text, so a long message cannot push the confirmation off the
    // top of a scrolled view.
    expect(chip).toBeLessThan(text)
    // Both inside the same box.
    expect(rows[chip]).toContain('│')
    expect(rows[text]).toContain('│')
  })

  it('draws one chip per image, in content order', async () => {
    const painted = await paintApp({ rows: 40 })
    await withImages(painted, [ref({ name: 'first.png' }), ref({ name: 'second.png' })], 'both')
    const rows = painted.screen().split('\n')
    painted.unmount()

    const first = rows.findIndex(r => r.includes('first.png'))
    const second = rows.findIndex(r => r.includes('second.png'))
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBe(first + 1)
  })

  it('draws a message that is only an image, with no blank text row', async () => {
    const painted = await paintApp({ rows: 40 })
    await withImages(painted, [ref()])
    const rows = painted.screen().split('\n')
    painted.unmount()

    const chip = rows.findIndex(r => r.includes('shot.png'))
    // The chip's row is the box's only content row: the closing corner is
    // directly under it. An empty text row here would push it down one.
    expect(rows[chip + 1]).toContain('╰')
  })

  it('falls back to a generic name when the ref carries none', async () => {
    // `name` is optional on the ref, and the session log rejects an explicit
    // `undefined` as non-serializable — so a nameless ref is one with the key
    // absent, which is what a store that strips path information produces.
    const nameless = ref()
    delete nameless.name
    const painted = await paintApp({ rows: 40 })
    await withImages(painted, [nameless], 'look')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('image · 1440×900 · 284 KB')
    expect(screen).not.toContain('undefined')
  })

  it('keeps a long filename to one row', async () => {
    // `truncate-end`, which is what lets `scroll.ts` charge exactly one row per
    // chip without measuring the string.
    const painted = await paintApp({ rows: 40, columns: 60 })
    await withImages(painted, [ref({ name: `${'a'.repeat(200)}.png` })], 'look')
    const rows = painted.screen().split('\n')
    painted.unmount()

    const chip = rows.findIndex(r => r.includes('aaaa'))
    expect(chip).toBeGreaterThanOrEqual(0)
    expect(rows[chip + 1]).not.toContain('aaaa')
  })

  it('reports small and large images in units a file manager agrees with', async () => {
    const painted = await paintApp({ rows: 40 })
    await withImages(painted, [ref({ name: 'tiny.gif', bytes: 912 })], 'a')
    await withImages(painted, [ref({ name: 'huge.png', bytes: 1_400_000 })], 'b')
    const screen = painted.screen()
    painted.unmount()

    expect(screen).toContain('tiny.gif · 1440×900 · 912 B')
    expect(screen).toContain('huge.png · 1440×900 · 1.4 MB')
  })
})
