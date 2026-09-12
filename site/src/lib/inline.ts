/**
 * Turns the `backtick` spans in the copy into <code>. Everything else is
 * escaped first, so a stray `<` in a string can never become markup.
 */
export function inline(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
}
