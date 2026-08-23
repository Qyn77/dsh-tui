/**
 * Pure markdown → UI AST. No React, no Ink, no I/O. The renderer
 * (`src/components/Markdown.tsx`) is a separate file so this function
 * stays a unit-testable pure mapping from string to node tree.
 *
 * The output AST is intentionally small: only what the TUI renders
 * (headings, paragraphs, code blocks, lists, blockquotes, inline
 * emphasis/code/links). HTML tables, images, and other extensions are
 * dropped — they have no good terminal analog and the dsh use case
 * doesn't need them.
 *
 * Failure mode: if `marked` throws on a partial input (unclosed
 * fence, unbalanced delimiter), we return the raw text as a single
 * `paragraph` so the UI never goes blank. The TUI is a conversation
 * surface, not a validator.
 * @module @deepseek-ai/dsh-tui/markdown
 */

import { marked, type MarkedToken, type Token } from 'marked'

/** Inline node — rendered inline with surrounding text. */
export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: InlineNode[] }
  | { kind: 'italic'; children: InlineNode[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: InlineNode[] }

/** Block node — one per line of layout in the assistant block. */
export type BlockNode =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { kind: 'paragraph'; children: InlineNode[] }
  | { kind: 'code-block'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'blockquote'; children: InlineNode[] }
  | { kind: 'thematic-break' }

/**
 * Width of the hanging indent applied to soft line breaks in a text
 * node. Models often hand-indent lyrics or dialog continuations by
 * 10+ spaces; the parser's pre-strip brings them down to zero, and
 * the renderer adds this uniform indent so the continuation reads
 * as a hanging indent (2 spaces) rather than flush-left. Two is
 * small enough not to crowd the terminal, large enough to be
 * visually distinct from a hard paragraph break.
 */
export const HANGING_INDENT = '  '

/**
 * Replace every soft line break in `text` with a newline followed
 * by `HANGING_INDENT` spaces. A blank line (`\n\n`) is preserved:
 * the regex only matches a `\n` that is *not* followed by another
 * `\n`, so internal paragraph breaks stay paragraph breaks.
 *
 * Called by the renderer on every text node; tested directly as a
 * pure function. The input is whatever the parser produced (already
 * pre-stripped of leading whitespace), so the only thing this
 * function does is restore a visual indent for line continuations.
 */
export function applyHangingIndent(text: string): string {
  return text.replace(/\n(?=[^\n])/g, `\n${HANGING_INDENT}`)
}

/**
 * Strip every leading space and tab from each newline-continued line
 * of a text node. Models often emit hand-indented lyrics or dialog
 * inside a paragraph (sometimes 10+ spaces deep); preserving those
 * as-is gives a visually-misleading "right-shifted run-on" in the
 * terminal. The CommonMark 4-space code-block rule does not help us
 * here — marked does not actually promote 4+ space continuations to
 * code blocks when they sit inside a paragraph, so they reach this
 * function as plain text.
 *
 * The match starts strictly after a `\n` and consumes only `[ \t]`,
 * not `\n` itself, so blank lines (`\n\n`) survive intact and the
 * paragraph break is preserved. Spaces at the very start of the
 * text, and spaces between inline elements (`**bold** word`), are
 * left alone — those are load-bearing separators.
 */
export function stripLeadingIndent(text: string): string {
  return text.replace(/\n[ \t]+/g, '\n')
}

/** Push a cleaned text node into an inline stream. No-op on empty input. */
function pushText(out: InlineNode[], text: string): void {
  if (text === '') return
  out.push({ kind: 'text', text: stripLeadingIndent(text) })
}

/**
 * Narrow marked's `Token[]` to its closed `MarkedToken` union.
 *
 * `Token` is `MarkedToken | Tokens.Generic`, and `Generic` declares
 * `[index: string]: any` alongside `type: string`. Because its `type` is the
 * open `string`, no `switch (tok.type)` in this file can ever exclude it, so
 * every `tok.text`, `tok.href` and `tok.tokens` read below silently resolved
 * through that index signature as `any`. Two things followed: the walkers were
 * unchecked (a renamed marked field would have compiled and produced empty
 * output at runtime), and `case 'tag'` survived as dead code — no member of
 * `MarkedToken` carries that type, and only `Generic` made it typecheck.
 *
 * marked emits `Generic` only for tokens created by custom extensions. This
 * package registers none — `marked.lexer` is called bare below — so the cast
 * is sound today. Registering an extension is what would invalidate it, and
 * this is the one place to revisit if that ever happens.
 * @param tokens - a token list from marked, at any nesting depth.
 * @returns the same list, typed as the closed union.
 */
function closed(tokens: readonly Token[]): readonly MarkedToken[] {
  return tokens as readonly MarkedToken[]
}

/** Walk a marked inline-token list into our own inline AST. */
function walkInline(tokens: readonly MarkedToken[]): InlineNode[] {  const out: InlineNode[] = []
  for (const tok of tokens) {
    walkOneInline(tok, out)
  }
  return out
}

function walkOneInline(tok: MarkedToken, out: InlineNode[]): void {
  switch (tok.type) {
    case 'text': {
      // `text` may carry nested inline tokens (links, em, strong).
      if (tok.tokens && tok.tokens.length > 0) {
        for (const inner of closed(tok.tokens)) walkOneInline(inner, out)
        return
      }
      pushText(out, tok.text ?? '')
      return
    }
    // `escape` and `image` both reduce to their literal text: an escape is
    // the character it escaped, and an image has no terminal analog, so its
    // alt text is the most useful thing left to show.
    case 'escape':
    case 'image':
      pushText(out, tok.text ?? '')
      return
    case 'strong':
      out.push({ kind: 'bold', children: walkInline(closed(tok.tokens ?? [])) })
      return
    case 'em':
      out.push({ kind: 'italic', children: walkInline(closed(tok.tokens ?? [])) })
      return
    case 'codespan':
      out.push({ kind: 'code', text: tok.text ?? '' })
      return
    case 'br':
      // Soft line break; the renderer emits a real `\n` newline.
      pushText(out, '\n')
      return
    case 'link': {
      // Drop the visible text in favor of the URL — terminals have
      // no hover; underlining a long label without a way to open the
      // target is worse than just showing the URL.
      const children: InlineNode[] = []
      pushText(children, tok.href ?? '')
      out.push({ kind: 'link', href: tok.href ?? '', children })
      return
    }
    case 'del':
      // Strikethrough has no clean SGR; keep the inner text plain.
      for (const inner of walkInline(closed(tok.tokens ?? []))) out.push(inner)
      return
    case 'checkbox':
      pushText(out, tok.checked ? '[x] ' : '[ ] ')
      return
    case 'html':
      // Strip raw HTML — Ink cannot safely render it, and an LLM
      // emitting `<script>` should never reach the user. marked reports
      // inline tags as `html` too (`Tokens.Tag.type` is `"html"`), so this
      // one case covers both; a separate `case 'tag'` used to sit here and
      // was unreachable.
      return
    default:
      pushText(out, extractRaw(tok))
      return
  }
}

/** Walk a marked block-token list into our own block AST. */
function walkBlock(tokens: readonly MarkedToken[]): BlockNode[] {
  const out: BlockNode[] = []
  for (const tok of tokens) walkOneBlock(tok, out)
  return out
}

function walkOneBlock(tok: MarkedToken, out: BlockNode[]): void {
  switch (tok.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, tok.depth)) as 1 | 2 | 3 | 4 | 5 | 6
      out.push({ kind: 'heading', level, children: walkInline(closed(tok.tokens ?? [])) })
      return
    }
    case 'paragraph':
      out.push({ kind: 'paragraph', children: walkInline(closed(tok.tokens ?? [])) })
      return
    case 'code': {
      const lang = (tok.lang ?? '').trim().split(/\s+/)[0] ?? ''
      out.push({ kind: 'code-block', lang, text: tok.text ?? '' })
      return
    }
    case 'blockquote': {
      // Flatten the blockquote into a single paragraph; the renderer
      // applies the `▏` left bar. The recursive token list lets us
      // pick up nested formatting correctly.
      const children: InlineNode[] = []
      for (const inner of tok.tokens ?? []) {
        if (inner.type === 'paragraph' || inner.type === 'text') {
          for (const node of walkInline(closed(inner.tokens ?? []))) children.push(node)
          pushText(children, '\n')
        }
      }
      if (children.length > 0) {
        const last = children[children.length - 1]
        if (last?.kind === 'text' && last.text === '\n') children.pop()
      }
      out.push({ kind: 'blockquote', children })
      return
    }
    case 'list': {
      const items: InlineNode[][] = []
      for (const item of tok.items ?? []) {
        // Each list item holds its content as nested tokens; flatten
        // them into one inline stream per item.
        items.push(flattenListItem(closed(item.tokens ?? [])))
      }
      out.push({ kind: 'list', ordered: tok.ordered, items })
      return
    }
    case 'hr':
      out.push({ kind: 'thematic-break' })
      return
    case 'space':
      return
    case 'html':
    case 'table':
    case 'def':
      // Drop — no terminal analog.
      return
    default:
      // Unknown block: render its raw text in a paragraph so nothing
      // is lost, but never crash the reducer chain.
      const raw = extractRaw(tok)
      if (raw.trim() !== '') out.push({ kind: 'paragraph', children: [{ kind: 'text', text: stripLeadingIndent(raw) }] })
      return
  }
}

function flattenListItem(tokens: readonly MarkedToken[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const tok of tokens) {
    if (tok.type === 'paragraph' || tok.type === 'text') {
      for (const inner of walkInline(closed(tok.tokens ?? []))) out.push(inner)
    } else if (tok.type === 'code') {
      out.push({ kind: 'code', text: tok.text ?? '' })
    } else {
      for (const inner of walkInline([tok])) out.push(inner)
    }
  }
  return out
}

/** Pull the `raw` field off any token (always present on marked tokens). */
function extractRaw(tok: MarkedToken): string {
  // `raw` is a string on every concrete token. The union type widens
  // it through `Generic`, so we narrow with a typeof check.
  const raw = (tok as { raw?: unknown }).raw
  return typeof raw === 'string' ? raw : ''
}

/**
 * Parse a markdown string into a block-AST. Pure: same input always
 * yields the same output. The empty string and unparseable input
 * both fall back to a single `paragraph` of raw text so the renderer
 * never goes blank.
 *
 * Before lexing, we strip 1+ leading spaces and tabs from every
 * newline-continuation line of the input. The post-parse text-node
 * strip alone cannot catch every case the model emits: when the
 * model writes blank-line-separated indented lines, CommonMark's
 * 4-space code-block rule promotes them to a fenced text frame and
 * the strip never sees them. Pre-stripping at the parse boundary
 * keeps the rule colocated with the lex call and turns
 * lyrics-style indents into normal paragraphs. The text-node
 * `pushText` still runs the same strip as a defense in depth.
 */
export function parseMarkdown(text: string): BlockNode[] {
  const trimmed = text
  if (trimmed === '') return []
  const cleaned = stripLeadingIndent(trimmed)
  let tokens: Token[]
  try {
    tokens = marked.lexer(cleaned)
  } catch {
    return [{ kind: 'paragraph', children: [{ kind: 'text', text: cleaned }] }]
  }
  try {
    return walkBlock(closed(tokens))
  } catch {
    return [{ kind: 'paragraph', children: [{ kind: 'text', text: cleaned }] }]
  }
}

/** True when the input has at least one block-level markdown construct. */
export function looksLikeMarkdown(text: string): boolean {
  if (text === '') return false
  // Cheap heuristic: any of the common block-level openers. This is
  // advisory — the renderer still calls `parseMarkdown`, which always
  // succeeds.
  return /(^|\n)#{1,6} \S|(^|\n)```|(^|\n) {0,3}>|(^|\n)\s*[-*+] \S|(^|\n)\s*\d+\. \S|(^|\n)---\s*(\n|$)/.test(text)
}
