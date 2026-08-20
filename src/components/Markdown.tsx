/**
 * Ink renderer for the markdown AST produced by `src/markdown.ts`.
 * Pure projection: given a list of blocks, returns a React subtree.
 *
 * Visual style (matches the conventions in `docs/SPEC.md`):
 *
 *   - Headings 1/2/3 → cyan / magenta / gray, all bold
 *   - Headings 4/5/6 → bold gray
 *   - Code block   → round border, gray dim code, language label on top
 *   - List items   → `▸` for unordered, `1.` style for ordered
 *   - Blockquote   → `▏` left bar, dimmed content
 *   - Inline code  → cyan dim
 *   - Bold/italic  → Ink `bold` / `italic`
 *   - Link         → underline blue, URL only
 *
 * The renderer never throws. A malformed inline stream falls back to
 * a plain text node so the chat surface never goes blank.
 * @module @deepseek-ai/dsh-tui/components/Markdown
 */

import React, { type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { parseMarkdown, type BlockNode, type InlineNode } from '../markdown.ts'

/** Props for the {@link Markdown} component. */
export interface MarkdownProps {
  /** The markdown source to render. Parsed once per render. */
  source: string
}

/**
 * Render a markdown string as Ink nodes. The block AST is recomputed
 * on every render — markdown text is small and `marked.lexer` is fast
 * (a few microseconds per kilobyte), so the cost is in the noise
 * against Ink's own diff.
 */
export function Markdown({ source }: MarkdownProps): ReactNode {
  const blocks = parseMarkdown(source)
  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => (
        <BlockRow key={idx} block={block} />
      ))}
    </Box>
  )
}

function BlockRow({ block }: { block: BlockNode }): ReactNode {
  switch (block.kind) {
    case 'heading':
      return <HeadingBlock level={block.level}>{block.children}</HeadingBlock>
    case 'paragraph':
      return <Box marginY={0}><Inlines nodes={block.children} /></Box>
    case 'code-block':
      return <CodeBlock lang={block.lang} text={block.text} />
    case 'list':
      return <ListBlock ordered={block.ordered} items={block.items} />
    case 'blockquote':
      return <BlockquoteBlock children={block.children} />
    case 'thematic-break':
      return <Text color="gray">────────────</Text>
  }
}

function HeadingBlock({ level, children }: {
  level: 1 | 2 | 3 | 4 | 5 | 6
  children: InlineNode[]
}): ReactNode {
  const color = level <= 2 ? 'cyan' : level === 3 ? 'magenta' : 'gray'
  return (
    <Box marginY={1}>
      <Text bold color={color}>
        <Inlines nodes={children} />
      </Text>
    </Box>
  )
}

function CodeBlock({ lang, text }: { lang: string; text: string }): ReactNode {
  const label = lang === '' ? '' : lang
  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="gray" paddingX={1}>
      {label !== '' && (
        <Box>
          <Text color="gray">code · </Text>
          <Text color="cyan" bold>{label}</Text>
        </Box>
      )}
      {label !== '' && <Text>{' '}</Text>}
      <Text color="gray" dimColor>
        {text}
      </Text>
    </Box>
  )
}

function ListBlock({ ordered, items }: {
  ordered: boolean
  items: readonly InlineNode[][]
}): ReactNode {
  return (
    <Box flexDirection="column" marginY={0}>
      {items.map((children, idx) => (
        <Box key={idx}>
          <Text color="gray">{ordered ? `${idx + 1}.` : '▸'}</Text>
          <Text>{' '}</Text>
          <Inlines nodes={children} />
        </Box>
      ))}
    </Box>
  )
}

function BlockquoteBlock({ children }: { children: InlineNode[] }): ReactNode {
  return (
    <Box marginY={0} marginLeft={1}>
      <Text color="gray">▏</Text>
      <Box flexDirection="column" marginLeft={1}>
        <Text color="gray" dimColor>
          <Inlines nodes={children} />
        </Text>
      </Box>
    </Box>
  )
}

function Inlines({ nodes }: { nodes: readonly InlineNode[] }): ReactNode {
  if (nodes.length === 0) return null
  return (
    <>
      {nodes.map((node, idx) => (
        <InlineNodeRow key={idx} node={node} />
      ))}
    </>
  )
}

function InlineNodeRow({ node }: { node: InlineNode }): ReactNode {
  switch (node.kind) {
    case 'text':
      return <Text>{node.text}</Text>
    case 'code':
      return <Text color="cyan" dimColor>{node.text}</Text>
    case 'bold':
      return <Text bold><Inlines nodes={node.children} /></Text>
    case 'italic':
      return <Text italic><Inlines nodes={node.children} /></Text>
    case 'link':
      return (
        <Text color="blue" underline>
          {node.children.map((c, i) => <InlineNodeRow key={i} node={c} />)}
        </Text>
      )
  }
}

// Re-export the AST types so consumers (tests, future virtualized
// variants) can render a pre-parsed tree without re-importing from
// `markdown.ts`.
export type { BlockNode, InlineNode } from '../markdown.ts'
