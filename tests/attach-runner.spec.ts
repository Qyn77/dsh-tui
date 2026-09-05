/**
 * Committing images from a submitted line: what gets attached, what is refused
 * out loud, and what is passed over in silence.
 */

import { describe, expect, it, vi } from 'vitest'
import type { ImageAttachmentLimits, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { attachImages, classifyModalities, type AttachDeps, type ImageStore } from '../src/attach-runner.ts'

const LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 1_000,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 1_500,
  maxImagePixels: 10_000_000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/** A store that accepts everything and hands back a predictable ref. */
function fakeStore(overrides: Partial<ImageStore> = {}): ImageStore {
  return {
    imageLimits: LIMITS,
    saveImage: async input => ({
      attachmentId: `id-${input.name ?? '?'}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 100,
      height: 50,
      name: input.name,
    }),
    ...overrides,
  }
}

/** Files the fake filesystem holds, by absolute path. */
function fakeFiles(files: Record<string, number>): AttachDeps['readFile'] {
  return async (path) => {
    const size = files[path]
    if (size === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    }
    return new Uint8Array(size)
  }
}

function deps(over: Partial<AttachDeps> = {}): AttachDeps {
  return {
    cwd: '/work',
    store: fakeStore(),
    readFile: fakeFiles({ '/work/a.png': 10, '/work/b.png': 20 }),
    imageSupport: async () => ({ support: 'yes', model: 'test-model' }),
    ...over,
  }
}

describe('attaching what the line names', () => {
  it('commits the image and takes its path out of the text', async () => {
    const out = await attachImages('look at ./a.png please', deps())
    expect(out.refs).toHaveLength(1)
    expect(out.refs[0]?.name).toBe('a.png')
    expect(out.text).toBe('look at please')
    expect(out.refusals).toEqual([])
  })

  it('keeps the order the paths appeared in', async () => {
    const out = await attachImages('b.png then a.png', deps())
    expect(out.refs.map(r => r.name)).toEqual(['b.png', 'a.png'])
  })

  it('sends the media type the extension claimed', async () => {
    const out = await attachImages('a.png', deps())
    expect(out.refs[0]?.mediaType).toBe('image/png')
  })

  it('sends a display name with no directory in it', async () => {
    const out = await attachImages('/deep/secret/a.png', deps({
      readFile: fakeFiles({ '/deep/secret/a.png': 10 }),
    }))
    expect(out.refs[0]?.name).toBe('a.png')
  })

  it('leaves a line with no image path completely alone', async () => {
    const save = vi.fn()
    const support = vi.fn()
    const out = await attachImages('  just talking  ', deps({
      store: fakeStore({ saveImage: save }),
      imageSupport: support as never,
    }))
    expect(out).toEqual({ refs: [], text: 'just talking', refusals: [] })
    // No provider call and no read for an ordinary message: the capability
    // question is only asked when there is something to attach.
    expect(support).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('what passes in silence', () => {
  it('says nothing about a path that does not exist', async () => {
    // The prose case. A warning row here would sit under every sentence that
    // happens to name a file.
    const out = await attachImages('the logo.png needs redoing', deps())
    expect(out.refs).toEqual([])
    expect(out.refusals).toEqual([])
    expect(out.text).toBe('the logo.png needs redoing')
  })

  it('says nothing about a tilde it cannot expand', async () => {
    const out = await attachImages('~/a.png', deps({ home: undefined }))
    expect(out.refusals).toEqual([])
    expect(out.text).toBe('~/a.png')
  })

  it('still attaches the real one beside a nonexistent one', async () => {
    const out = await attachImages('compare a.png with ghost.png', deps())
    expect(out.refs.map(r => r.name)).toEqual(['a.png'])
    expect(out.refusals).toEqual([])
    // The one that did not attach keeps its place in the sentence.
    expect(out.text).toBe('compare with ghost.png')
  })
})

describe('refusals', () => {
  it('reports a file that exists but cannot be read', async () => {
    const out = await attachImages('a.png', deps({
      readFile: async () => {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      },
    }))
    expect(out.refusals).toEqual([{ kind: 'unreadable', name: 'a.png' }])
    expect(out.text).toBe('a.png')
  })

  it('reports one that is over the per-image limit', async () => {
    const out = await attachImages('big.png', deps({
      readFile: fakeFiles({ '/work/big.png': 5_000 }),
    }))
    expect(out.refusals).toEqual([
      { kind: 'too-large', name: 'big.png', bytes: 5_000, limit: 1_000 },
    ])
    expect(out.refs).toEqual([])
  })

  it('reports the overflow past the per-message count', async () => {
    const out = await attachImages('a.png b.png c.png', deps({
      readFile: fakeFiles({ '/work/a.png': 10, '/work/b.png': 20, '/work/c.png': 30 }),
    }))
    expect(out.refs).toHaveLength(2)
    expect(out.refusals).toEqual([{ kind: 'too-many', dropped: 1, limit: 2 }])
  })

  it('does not count nonexistent files toward the overflow', async () => {
    const out = await attachImages('a.png ghost1.png ghost2.png b.png', deps())
    expect(out.refs).toHaveLength(2)
    expect(out.refusals).toEqual([])
  })

  it('reports the overflow past the whole-message byte budget', async () => {
    const out = await attachImages('a.png b.png', deps({
      readFile: fakeFiles({ '/work/a.png': 900, '/work/b.png': 900 }),
    }))
    expect(out.refs).toHaveLength(1)
    expect(out.refusals).toEqual([{ kind: 'too-much', dropped: 1, limit: 1_500 }])
  })

  it('passes the store\'s own message through when it rejects the bytes', async () => {
    const out = await attachImages('a.png', deps({
      store: fakeStore({
        saveImage: async () => {
          throw new Error('declared image/png, decoded image/jpeg')
        },
      }),
    }))
    expect(out.refusals).toEqual([
      { kind: 'rejected', name: 'a.png', message: 'declared image/png, decoded image/jpeg' },
    ])
    expect(out.text).toBe('a.png')
  })

  it('refuses everything when no store is mounted, and reads nothing', async () => {
    const readFile = vi.fn()
    const out = await attachImages('a.png', deps({ store: undefined, readFile: readFile as never }))
    expect(out.refusals).toEqual([{ kind: 'no-store' }])
    expect(readFile).not.toHaveBeenCalled()
    expect(out.text).toBe('a.png')
  })

  it('refuses when the route declares no image modality, and reads nothing', async () => {
    const readFile = vi.fn()
    const out = await attachImages('a.png', deps({
      readFile: readFile as never,
      imageSupport: async () => ({ support: 'no', model: 'text-only-1' }),
    }))
    expect(out.refusals).toEqual([{ kind: 'unsupported', model: 'text-only-1' }])
    expect(readFile).not.toHaveBeenCalled()
  })

  it('attaches when the route discloses nothing', async () => {
    const out = await attachImages('a.png', deps({
      imageSupport: async () => ({ support: 'unknown', model: 'mystery-1' }),
    }))
    expect(out.refs).toHaveLength(1)
    expect(out.refusals).toEqual([])
  })
})

describe('every refusal still sends the text', () => {
  it.each([
    ['no store', deps({ store: undefined })],
    ['unsupported route', deps({ imageSupport: async () => ({ support: 'no' as const, model: 'm' }) })],
    ['too large', deps({ readFile: fakeFiles({ '/work/a.png': 5_000 }) })],
    ['store rejection', deps({
      store: fakeStore({ saveImage: async () => { throw new Error('bad bytes') } }),
    })],
  ])('%s', async (_label, d) => {
    const out = await attachImages('please read a.png closely', d)
    // Losing the typed line to a bad attachment is the one outcome that is
    // never acceptable, so the path stays in the text it could not leave.
    expect(out.text).toBe('please read a.png closely')
  })
})

describe('reading a route\'s declared modalities', () => {
  it('treats an absent list as unknown, not as a refusal', () => {
    expect(classifyModalities(undefined)).toBe('unknown')
  })

  it('treats an explicit omission as negative capability', () => {
    expect(classifyModalities(['text'])).toBe('no')
  })

  it('accepts a list that names image', () => {
    expect(classifyModalities(['text', 'image'])).toBe('yes')
  })

  it('treats an empty list as negative capability', () => {
    expect(classifyModalities([])).toBe('no')
  })
})
