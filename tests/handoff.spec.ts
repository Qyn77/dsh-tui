import { PassThrough } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { createTerminalHandoff } from '../src/terminal/handoff.ts'
it('hands off input/output and restores both after a failed editor, without replacing Ink readers', async () => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, isRaw: true, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn() })
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 })
  stdin.pause()
  const pause = vi.fn()
  stdin.on('pause', pause)
  const bridge = createTerminalHandoff(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream)
  let written = ''
  stdout.on('data', chunk => { written += String(chunk) })
  const leave = vi.fn(), enter = vi.fn(), read = vi.fn()
  bridge.stdin.on('readable', read)
  const readers = bridge.stdin.listeners('readable')
  await expect(bridge.run(async () => {
    expect(pause).toHaveBeenCalledOnce()
    bridge.stdout.write('must not repaint the editor')
    expect(stdin.listeners('readable')).toHaveLength(0)
    throw Error('child failed')
  }, leave, enter)).rejects.toThrow('child failed')
  expect(written).toBe('')
  bridge.stdout.write('restored')
  expect(written).toBe('restored')
  expect(stdin.setRawMode.mock.calls.map(args => args[0])).toEqual([false, true])
  expect(bridge.stdin.listeners('readable')).toEqual(readers)
  expect(leave).toHaveBeenCalledOnce(); expect(enter).toHaveBeenCalledOnce()
  bridge.dispose()
  expect(stdin.listeners('readable')).toHaveLength(0)
})
