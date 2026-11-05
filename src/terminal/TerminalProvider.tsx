import React, { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { useStdin, type Key } from 'ink'
import { createTerminalService, type TerminalService } from './adapters/service.ts'
import type { TerminalEvent } from './adapters/input.ts'

const TerminalContext = createContext<TerminalService | undefined>(undefined)
export function TerminalProvider({ service, children }: { service?: TerminalService; children: ReactNode }) {
  const [fallback] = useState(() => service ?? createTerminalService())
  const terminal = service ?? fallback
  const { internal_eventEmitter: events, setRawMode } = useStdin()
  useLayoutEffect(() => {
    setRawMode(true)
    const detach = terminal.attach(events)
    return () => { detach(); setRawMode(false) }
  }, [terminal, events, setRawMode])
  return <TerminalContext.Provider value={terminal}>{children}</TerminalContext.Provider>
}
export function useTerminal(): TerminalService {
  const value = useContext(TerminalContext)
  if (!value) throw new Error('TerminalProvider is required')
  return value
}
/** Snapshot each handler at dispatch start: one key must see one UI state. */
export function useTerminalEvent(handler: (event: TerminalEvent) => void, active = true): void {
  const terminal = useTerminal()
  useLayoutEffect(() => {
    if (!active) return
    return terminal.subscribe(handler)
  }, [terminal, active, handler])
}
export function useTerminalInput(handler: (input: string, key: Key) => void, options: { isActive?: boolean } = {}): void {
  useTerminalEvent((event) => { if (event.kind === 'key') handler(event.input, event.key) }, options.isActive !== false)
}
