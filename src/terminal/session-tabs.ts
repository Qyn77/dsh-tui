/** UI-only tab order. Durable sessions and owned agent handles belong to the runtime. */
export function createSessionTabs(initial: string) {
  let ids = [initial]
  return {
    list: () => [...ids],
    open(id: string) { if (!ids.includes(id)) ids = [...ids, id] },
    close(id: string) { if (ids.length > 1) ids = ids.filter(value => value !== id) },
    target(current: string, direction: 'next' | 'prev') {
      const at = ids.indexOf(current)
      return ids[(Math.max(0, at) + (direction === 'next' ? 1 : ids.length - 1)) % ids.length]
    },
  }
}
