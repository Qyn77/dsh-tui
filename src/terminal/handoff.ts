import { PassThrough, Writable } from 'node:stream'

/** Public Ink streams with one owner; suppress UI writes while an editor owns the real TTY. */
export function createTerminalHandoff(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream) {
  let suspended = false
  let raw = stdin.isRaw
  const input = new PassThrough() as PassThrough & Pick<NodeJS.ReadStream, 'isTTY' | 'setRawMode' | 'ref' | 'unref'>
  input.isTTY = stdin.isTTY
  input.setRawMode = (mode: boolean) => { raw = mode; if (!suspended) stdin.setRawMode(mode); return input as never }
  input.ref = () => { stdin.ref(); return input as never }
  input.unref = () => { stdin.unref(); return input as never }
  const output = new Writable({ write(chunk, encoding, done) {
    if (suspended) done()
    else stdout.write(chunk, encoding, done)
  } }) as Writable & Pick<NodeJS.WriteStream, 'isTTY' | 'columns' | 'rows'>
  Object.defineProperties(output, {
    isTTY: { get: () => stdout.isTTY }, columns: { get: () => stdout.columns }, rows: { get: () => stdout.rows },
  })
  const read = () => { let chunk: string | Buffer | null; while ((chunk = stdin.read()) !== null) input.write(chunk) }
  const resize = () => { if (!suspended) output.emit('resize') }
  stdin.on('readable', read)
  stdout.on('resize', resize)
  return {
    stdin: input as unknown as NodeJS.ReadStream,
    stdout: output as unknown as NodeJS.WriteStream,
    async run<T>(action: () => Promise<T>, leave: () => void, enter: () => void): Promise<T> {
      if (suspended) throw new Error('Terminal handoff already active')
      suspended = true
      stdin.off('readable', read)
      // Ignore SIGINT in the parent only while the editor receives it through the shared TTY.
      const ignore = () => {}
      process.on('SIGINT', ignore)
      try {
        // Let Readable clear its readable-listener flag before changing flow.
        await new Promise<void>(resolve => setImmediate(resolve))
        // A stream in readable mode reports paused even while libuv reads.
        // Force the transition that process.stdin uses to stop its fd reader.
        stdin.resume()
        stdin.pause()
        await new Promise<void>(resolve => setImmediate(resolve))
        stdin.setRawMode(false); leave(); return await action()
      }
      finally {
        try { enter() }
        finally {
          suspended = false
          stdin.setRawMode(raw)
          stdin.on('readable', read)
          process.off('SIGINT', ignore)
          output.emit('resize')
        }
      }
    },
    dispose() { stdin.off('readable', read); stdout.off('resize', resize) },
  }
}
