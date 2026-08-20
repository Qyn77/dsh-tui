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

import { marked, type Token } from 'marked'

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

/** Walk a marked inline-token list into our own inline AST. */
function walkInline(tokens: readonly Token[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const tok of tokens) {
    walkOneInline(tok, out)
  }
  return out
}

function walkOneInline(tok: Token, out: InlineNode[]): void {
  switch (tok.type) {
    case 'text': {
      // `text` may carry nested inline tokens (links, em, strong).
      if (tok.tokens && tok.tokens.length > 0) {
        for (const inner of tok.tokens) walkOneInline(inner, out)
        return
      }
      out.push({ kind: 'text', text: tok.text ?? '' })
      return
    }
    case 'escape':
      out.push({ kind: 'text', text: tok.text ?? '' })
      return
    case 'strong':
      out.push({ kind: 'bold', children: walkInline(tok.tokens ?? []) })
      return
    case 'em':
      out.push({ kind: 'italic', children: walkInline(tok.tokens ?? []) })
      return
    case 'codespan':
      out.push({ kind: 'code', text: tok.text ?? '' })
      return
    case 'br':
      out.push({ kind: 'text', text: '\n' })
      return
    case 'link': {
      // Drop the visible text in favor of the URL — terminals have
      // no hover; underlining a long label without a way to open the
      // target is worse than just showing the URL.
      out.push({ kind: 'link', href: tok.href ?? '', children: [{ kind: 'text', text: tok.href ?? '' }] })
      return
    }
    case 'image':
      // No terminal analog; fall through to a plain text marker.
      out.push({ kind: 'text', text: tok.text ?? '' })
      return
    case 'del':
      // Strikethrough has no clean SGR; keep the inner text plain.
      for (const inner of walkInline(tok.tokens ?? [])) out.push(inner)
      return
    case 'checkbox':
      out.push({ kind: 'text', text: tok.checked ? '[x] ' : '[ ] ' })
      return
    case 'html':
    case 'tag':
      // Strip raw HTML — Ink cannot safely render it, and an LLM
      // emitting `<script>` should never reach the user.
      return
    default:
      out.push({ kind: 'text', text: extractRaw(tok) })
      return
  }
}

/** Walk a marked block-token list into our own block AST. */
function walkBlock(tokens: readonly Token[]): BlockNode[] {
  const out: BlockNode[] = []
  for (const tok of tokens) walkOneBlock(tok, out)
  return out
}

function walkOneBlock(tok: Token, out: BlockNode[]): void {
  switch (tok.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, tok.depth)) as 1 | 2 | 3 | 4 | 5 | 6
      out.push({ kind: 'heading', level, children: walkInline(tok.tokens ?? []) })
      return
    }
    case 'paragraph':
      out.push({ kind: 'paragraph', children: walkInline(tok.tokens ?? []) })
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
          for (const node of walkInline(inner.tokens ?? [])) children.push(node)
          children.push({ kind: 'text', text: '\n' })
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
        items.push(flattenListItem(item.tokens ?? []))
      }
      out.push({ kind: 'list', ordered: Boolean(tok.ordered), items })
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
      if (raw.trim() !== '') out.push({ kind: 'paragraph', children: [{ kind: 'text', text: raw }] })
      return
  }
}

function flattenListItem(tokens: readonly Token[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const tok of tokens) {
    if (tok.type === 'paragraph' || tok.type === 'text') {
      for (const inner of walkInline(tok.tokens ?? [])) out.push(inner)
    } else if (tok.type === 'code') {
      out.push({ kind: 'code', text: tok.text ?? '' })
    } else {
      for (const inner of walkInline([tok])) out.push(inner)
    }
  }
  return out
}

/** Pull the `raw` field off any token (always present on marked tokens). */
function extractRaw(tok: Token): string {
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
 */
export function parseMarkdown(text: string): BlockNode[] {
  const trimmed = text
  if (trimmed === '') return []
  let tokens: Token[]
  try {
    tokens = marked.lexer(trimmed)
  } catch {
    return [{ kind: 'paragraph', children: [{ kind: 'text', text: trimmed }] }]
  }
  try {
    return walkBlock(tokens)
  } catch {
    return [{ kind: 'paragraph', children: [{ kind: 'text', text: trimmed }] }]
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
