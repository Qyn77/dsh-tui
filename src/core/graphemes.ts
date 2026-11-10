/** UTF-16 offsets at user-visible character boundaries, shared by editing and layout. */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function* graphemes(text: string): Iterable<string> {
  // Every character in this restricted set is a standalone grapheme. Keep large
  // ASCII/CJK menus cheap; marks, joiners, emoji and all other text use ICU.
  if (/^[\u0020-\u007e\u3400-\u9fff]*$/.test(text)) {
    yield* text
    return
  }
  for (const { segment } of segmenter.segment(text)) yield segment
}

/** Clamp a stale offset to the start of its grapheme. The buffer end is a boundary. */
export function graphemeStart(text: string, cursor: number): number {
  const at = Math.max(0, Math.min(text.length, Math.floor(cursor) || 0))
  return segmenter.segment(text).containing(at)?.index ?? at
}

export function previousGrapheme(text: string, cursor: number): number {
  const at = Math.max(0, Math.min(text.length, Math.floor(cursor) || 0))
  return at === 0 ? 0 : graphemeStart(text, at - 1)
}

export function nextGrapheme(text: string, cursor: number): number {
  const at = graphemeStart(text, cursor)
  const part = segmenter.segment(text).containing(at)
  return part ? at + part.segment.length : at
}
