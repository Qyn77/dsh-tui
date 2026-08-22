/**
 * Terminal column arithmetic. Pure: no React, no Ink, no IO — the prompt's
 * line wrapping and the banner's centering both fold text against a column
 * budget, and both need the same answer to "how wide is this really?".
 * @module @deepseek-ai/dsh-tui/width
 */

/**
 * Display width of `text` in terminal columns. CJK characters occupy
 * two columns, which matters here because the slogan is Chinese and
 * `String.length` would report half its true width — centering on
 * `.length` puts it visibly off to the right.
 *
 * The ranges covered are the ones the UI actually uses: CJK ideographs,
 * the Chinese/Japanese punctuation block (which is where `！` lives),
 * Hiragana/Katakana, and Hangul. A full `wcwidth` implementation is
 * not worth the dependency for one slogan.
 * @param text - the string to measure.
 */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals … Yi
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
      (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
      (code >= 0xff00 && code <= 0xff60) || // Fullwidth forms
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd) // CJK extension planes
    width += isWide ? 2 : 1
  }
  return width
}
