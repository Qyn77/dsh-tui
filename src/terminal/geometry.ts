import type { DOMElement } from 'ink'

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
