import type { DOMElement } from 'ink'

/**
 * Bound the live Ink frame while leaving only one physical row for the
 * terminal's incremental eraser. The old three-row reserve made the prompt
 * visibly float above the bottom on short macOS windows.
 */
export function liveFrameHeight(rows: number, isTTY: boolean, hasEntries: boolean): number | undefined {
  if (!isTTY && !hasEntries) return undefined
  return Math.max(1, Math.floor(rows) - 1)
}

/** Terminal-cell bounds in Ink's alternate-screen coordinate system. */
export function cellBounds(node: DOMElement): { x: number; y: number; width: number; height: number } {
  let x = 0
  let y = 0
  for (let current: DOMElement | undefined = node; current; current = current.parentNode) {
    x += current.yogaNode?.getComputedLeft() ?? 0
    y += current.yogaNode?.getComputedTop() ?? 0
  }
  return { x, y, width: node.yogaNode?.getComputedWidth() ?? 0, height: node.yogaNode?.getComputedHeight() ?? 0 }
}

export function containsCell(bounds: ReturnType<typeof cellBounds>, x: number, y: number): boolean {
  return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height
}
