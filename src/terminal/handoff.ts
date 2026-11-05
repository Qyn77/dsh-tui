import { PassThrough, Writable } from 'node:stream'

/** Public Ink streams with one owner; suppress UI writes while an editor owns the real TTY. */
export function createTerminalHandoff(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream) {
  let suspended = false
  let disposed = false
  const ignoreInterrupt = () => {}
  let raw = stdin.isRaw
  const input = new PassThrough() as PassThrough & Pick<NodeJS.ReadStream, 'isTTY' | 'setRawMode' | 'ref' | 'unref'>
  input.isTTY = stdin.isTTY
  input.setRawMode = (mode: boolean) => { raw = mode; if (!suspended && !disposed) stdin.setRawMode(mode); return input as never }
  input.ref = () => { stdin.ref(); return input as never }
  input.unref = () => { stdin.unref(); return input as never }
  const output = new Writable({ write(chunk: Buffer, encoding, done) {
    if (suspended || disposed) done()
    else stdout.write(chunk, encoding, done)
  } }) as Writable & Pick<NodeJS.WriteStream, 'isTTY' | 'columns' | 'rows'>
  Object.defineProperties(output, {
    isTTY: { get: () => stdout.isTTY }, columns: { get: () => stdout.columns }, rows: { get: () => stdout.rows },
  })
  const read = () => {
    if (disposed || suspended) return
    for (;;) {
      const chunk: unknown = stdin.read()
      if (chunk === null) break
      if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) input.write(chunk)
    }
  }
  const resize = () => { if (!suspended && !disposed) output.emit('resize') }
  stdin.on('readable', read)
  stdout.on('resize', resize)
  return {
    get disposed() { return disposed },
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    async run<T>(action: () => Promise<T>, leave: () => void, enter: () => void): Promise<T> {
      if (disposed) throw new Error('Terminal handoff disposed')
      if (suspended) throw new Error('Terminal handoff already active')
      suspended = true
      stdin.off('readable', read)
      // Ignore SIGINT in the parent only while the editor receives it through the shared TTY.
      process.on('SIGINT', ignoreInterrupt)
      try {
        // Let Readable clear its readable-listener flag before changing flow.
        await new Promise<void>(resolve => setImmediate(resolve))
        if (disposed) throw new Error('Terminal handoff disposed')
        // A stream in readable mode reports paused even while libuv reads.
        // Force the transition that process.stdin uses to stop its fd reader.
        stdin.resume()
        stdin.pause()
        await new Promise<void>(resolve => setImmediate(resolve))
        if (disposed) throw new Error('Terminal handoff disposed')
        stdin.setRawMode(false)
        leave()
        if (disposed) throw new Error('Terminal handoff disposed')
        return await action()
      }
      finally {
        process.off('SIGINT', ignoreInterrupt)
        try { if (!disposed) enter() }
        finally {
          suspended = false
          if (!disposed) {
            stdin.setRawMode(raw)
            stdin.on('readable', read)
            output.emit('resize')
          }
        }
      }
    },
    dispose() {
      disposed = true
      stdin.off('readable', read)
      stdout.off('resize', resize)
      process.off('SIGINT', ignoreInterrupt)
    },
  }
}
