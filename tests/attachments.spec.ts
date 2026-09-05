/**
 * Image-path detection in a submitted line: quoting, escapes, what counts as an
 * image, and what the line looks like once the attachments are taken out.
 */

import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  displayName,
  findImageCandidates,
  IMAGE_MEDIA_TYPES,
  resolveCandidate,
  textWithoutCandidates,
} from '../src/attachments.ts'

describe('finding image paths', () => {
  it('finds a bare relative path', () => {
    const found = findImageCandidates('here is the bug ./shot.png')
    expect(found).toHaveLength(1)
    expect(found[0]?.path).toBe('./shot.png')
    expect(found[0]?.mediaType).toBe('image/png')
  })

  it('finds a path that is the whole line', () => {
    const found = findImageCandidates('/tmp/a.jpeg')
    expect(found.map(c => c.path)).toEqual(['/tmp/a.jpeg'])
  })

  it('finds more than one, in the order they appear', () => {
    const found = findImageCandidates('compare a.png with b.webp please')
    expect(found.map(c => c.path)).toEqual(['a.png', 'b.webp'])
  })

  it('maps every accepted extension to its media type', () => {
    const found = findImageCandidates('a.png b.jpg c.jpeg d.webp e.gif')
    expect(found.map(c => c.mediaType)).toEqual([
      'image/png', 'image/jpeg', 'image/jpeg', 'image/webp', 'image/gif',
    ])
  })

  it('is case-insensitive about the extension', () => {
    expect(findImageCandidates('SHOT.PNG')[0]?.mediaType).toBe('image/png')
  })

  it('ignores a file type the attachment store does not accept', () => {
    // Not an oversight: `ImageMediaType` is exactly four types, so a `.bmp`
    // candidate would only travel as far as `saveImage` before being refused.
    expect(findImageCandidates('diagram.bmp report.pdf notes.txt')).toEqual([])
  })

  it('ignores a bare extension with no stem', () => {
    // `.png` is a dotfile name, and someone discussing file formats should not
    // find themselves attaching one from the working directory.
    expect(findImageCandidates('should we use .png or .gif here')).toEqual([])
  })

  it('ignores an extension that is only part of a word', () => {
    expect(findImageCandidates('the pnglib module')).toEqual([])
  })
})

describe('paths a terminal produces on drag and drop', () => {
  it('reads a backslash-escaped space', () => {
    const found = findImageCandidates('look at /tmp/my\\ shot.png ok')
    expect(found.map(c => c.path)).toEqual(['/tmp/my shot.png'])
  })

  it('reads a single-quoted path', () => {
    const found = findImageCandidates("look at '/tmp/my shot.png' ok")
    expect(found.map(c => c.path)).toEqual(['/tmp/my shot.png'])
  })

  it('reads a double-quoted path', () => {
    const found = findImageCandidates('look at "/tmp/my shot.png" ok')
    expect(found.map(c => c.path)).toEqual(['/tmp/my shot.png'])
  })

  it('keeps a backslash literal inside single quotes, as a shell would', () => {
    const found = findImageCandidates("'/tmp/a\\b.png'")
    expect(found.map(c => c.path)).toEqual(['/tmp/a\\b.png'])
  })

  it('spans the quotes when reporting where the token sat', () => {
    const text = "see '/tmp/a b.png' now"
    const found = findImageCandidates(text)
    expect(text.slice(found[0]?.start, found[0]?.end)).toBe("'/tmp/a b.png'")
  })

  it('handles several escaped spaces in one path', () => {
    const found = findImageCandidates('/tmp/a\\ b\\ c.png')
    expect(found.map(c => c.path)).toEqual(['/tmp/a b c.png'])
  })

  it('keeps a trailing lone backslash literal', () => {
    // Likelier a Windows path fragment than an unfinished escape, and escaping
    // the end of input would silently swallow the token.
    expect(findImageCandidates('a.png\\').map(c => c.path)).toEqual([])
  })
})

describe('the text left behind', () => {
  it('removes the token and collapses the gap', () => {
    const text = 'look at ./a.png and tell me'
    const found = findImageCandidates(text)
    expect(textWithoutCandidates(text, found)).toBe('look at and tell me')
  })

  it('yields an empty string when the path was the whole line', () => {
    const text = '  /tmp/a.png  '
    expect(textWithoutCandidates(text, findImageCandidates(text))).toBe('')
  })

  it('keeps a candidate the caller did not attach', () => {
    // The rejected one stays in the message: the user still gets to say the
    // filename they typed, and the sentence still reads.
    const text = 'compare a.png with b.png'
    const found = findImageCandidates(text)
    expect(textWithoutCandidates(text, [found[0] as never])).toBe('compare with b.png')
  })

  it('returns the trimmed original when nothing was attached', () => {
    expect(textWithoutCandidates('  hello  ', [])).toBe('hello')
  })

  it('does not depend on the order it is given', () => {
    const text = 'a.png then b.png'
    const found = findImageCandidates(text)
    const reversed = [...found].reverse()
    expect(textWithoutCandidates(text, reversed)).toBe('then')
  })
})

describe('resolving a candidate', () => {
  const at = (path: string) => findImageCandidates(path)[0] as never

  it('leaves an absolute path alone', () => {
    expect(resolveCandidate(at('/tmp/a.png'), { cwd: '/work' })).toBe('/tmp/a.png')
  })

  it('resolves a relative path against the cwd', () => {
    expect(resolveCandidate(at('./a.png'), { cwd: '/work' })).toBe(resolve('/work/a.png'))
  })

  it('expands a leading tilde', () => {
    expect(resolveCandidate(at('~/a.png'), { cwd: '/work', home: '/home/me' }))
      .toBe(resolve('/home/me/a.png'))
  })

  it('cannot resolve a tilde with no home', () => {
    expect(resolveCandidate(at('~/a.png'), { cwd: '/work' })).toBeUndefined()
  })
})

describe('the display name', () => {
  it('strips the directory, so the log does not record the local layout', () => {
    expect(displayName(findImageCandidates('/home/me/secret/dir/a.png')[0] as never))
      .toBe('a.png')
  })
})

describe('the media type table', () => {
  it('claims only types the attachment store accepts', () => {
    const accepted = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    for (const value of Object.values(IMAGE_MEDIA_TYPES)) expect(accepted).toContain(value)
  })
})
