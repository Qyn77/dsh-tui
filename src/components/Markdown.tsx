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

import React, { useMemo, type ReactNode } from 'react'
import { Box, Text } from 'ink'
import { applyHangingIndent, parseMarkdown, type BlockNode, type InlineNode } from '../markdown.ts'
import { useCodeHighlight } from '../hooks/useCodeHighlight.ts'
import { useStrings } from '../hooks/useStrings.tsx'

/** Props for the {@link Markdown} component. */
export interface MarkdownProps {
  /** The markdown source to render. Parsed once per render. */
  source: string
}

/**
 * Render a markdown string as Ink nodes.
 *
 * The AST is memoized on the source. Every mounted entry re-renders on every
 * `assistant/chunk` event, so without this an unchanged turn from ten minutes
 * ago is re-lexed a few thousand times over the course of the next answer —
 * and once streaming turns render as markdown too (§1.9), the growing text is
 * re-lexed from the top on every delta besides. A single parse is cheap (0.4ms
 * for a 20KB document, measured); a mounted window's worth of them per delta
 * is not, and neither is free when the whole point of the frame is to keep up
 * with a token stream.
 */
export function Markdown({ source }: MarkdownProps): ReactNode {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => (
        <BlockRow
          key={idx}
          block={block}
          first={idx === 0}
          last={idx === blocks.length - 1}
        />
      ))}
    </Box>
  )
}

/**
 * One markdown block, spaced against its siblings but not against its
 * container.
 *
 * Blocks are separated by a blank row — without it, model-written lyrics and
 * dialog look smushed together (§1.9). Ink does not collapse margins, so that
 * row has to be suppressed at the document's outer edges: a markdown document
 * padding its own top and bottom would put a blank row between an assistant
 * turn's header and its first line, and another before the next entry, on top
 * of whatever spacing the conversation itself asked for.
 */
function BlockRow({ block, first, last }: {
  block: BlockNode
  /** First block in the document — no leading blank row. */
  first: boolean
  /** Last block in the document — no trailing blank row. */
  last: boolean
}): ReactNode {
  const top = first ? 0 : 1
  const bottom = last ? 0 : 1
  switch (block.kind) {
    case 'heading':
      return (
        <HeadingBlock level={block.level} marginTop={top} marginBottom={bottom}>
          {block.children}
        </HeadingBlock>
      )
    case 'paragraph':
      return (
        <Box marginTop={top} marginBottom={bottom}>
          <Text>
            <Inlines nodes={block.children} />
          </Text>
        </Box>
      )
    case 'code-block':
      return <CodeBlock lang={block.lang} text={block.text} marginTop={top} marginBottom={bottom} />
    case 'list':
      return <ListBlock ordered={block.ordered} items={block.items} />
    case 'blockquote':
      return <BlockquoteBlock children={block.children} />
    case 'thematic-break':
      return <Text color="gray">────────────</Text>
  }
}

function HeadingBlock({ level, children, marginTop, marginBottom }: {
  level: 1 | 2 | 3 | 4 | 5 | 6
  children: InlineNode[]
  marginTop: number
  marginBottom: number
}): ReactNode {
  const color = level <= 2 ? 'cyan' : level === 3 ? 'magenta' : 'gray'
  return (
    <Box marginTop={marginTop} marginBottom={marginBottom}>
      <Text bold color={color}>
        <Inlines nodes={children} />
      </Text>
    </Box>
  )
}

/**
 * A fenced code block: a language label, then the code.
 *
 * The code is drawn one `<Text>` row per source line rather than one `<Text>`
 * holding the newlines, because a highlighted line is several differently-colored
 * spans and they have to nest inside something. The row count is the same either
 * way, which matters: the block renders plain until its grammar loads and colored
 * afterwards, and the switch must not move the rows under the reader.
 *
 * An empty line renders as a single space. A zero-width `<Text>` is not
 * guaranteed a row of its own, and a blank line inside code is content — it is
 * how the model separates functions.
 */
function CodeBlock({ lang, text, marginTop, marginBottom }: {
  lang: string
  text: string
  marginTop: number
  marginBottom: number
}): ReactNode {
  const strings = useStrings()
  const label = lang === '' ? '' : lang
  const highlighted = useCodeHighlight(lang, text)
  return (
    <Box
      flexDirection="column"
      marginTop={marginTop}
      marginBottom={marginBottom}
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
    >
      {label !== '' && (
        <Text>
          <Text color="gray">{strings.markdown.codeFence}</Text>
          <Text color="cyan" bold>{label}</Text>
        </Text>
      )}
      {label !== '' && <Text>{' '}</Text>}
      {highlighted === undefined
        ? text.split('\n').map((line, index) => (
          // The index is the key because these are a positional slice of one
          // string: nothing reorders, and blank lines are not unique.
          <Text key={index} color="gray" dimColor>{line === '' ? ' ' : line}</Text>
        ))
        : highlighted.map((line, index) => (
          <Text key={index}>
            {line.length === 0 ? ' ' : line.map((token, span) => (
              <Text
                key={span}
                color={token.color}
                bold={token.bold}
                italic={token.italic}
                underline={token.underline}
              >
                {token.text}
              </Text>
            ))}
          </Text>
        ))}
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
        <Box key={idx} flexDirection="row">
          <Text color="gray">{ordered ? `${idx + 1}.` : '▸'}{' '}</Text>
          <Text>
            <Inlines nodes={children} />
          </Text>
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
      // Soft line breaks (the model's hand-typed lyrics/dialog
      // continuations) get a uniform 2-space hanging indent so the
      // continuation reads as a hanging indent rather than flush-left
      // (which the parser's pre-strip leaves it at) or right-shifted
      // (which the model's own 10+-space indent would). See §1.9.
      return <Text>{applyHangingIndent(node.text)}</Text>
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
