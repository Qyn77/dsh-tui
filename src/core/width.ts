import stringWidth from 'string-width'

/** Use the same Unicode column rules as Ink, including emoji and combining marks. */
export function displayWidth(text: string): number {
  // Menus measure many short ASCII fragments; avoid allocating a segmenter for each.
  if (/^[\u0020-\u007e]*$/.test(text)) return text.length
  return stringWidth(text)
}
