import { checkpointRepository, CheckpointError, type Checkpoint } from '../terminal/checkpoints.ts'
import type { Catalog } from '../core/i18n.ts'
import { diffLines } from '../render/file-diffs.ts'

export function checkpointDescription(item: Checkpoint, labels: Catalog['checkpoint']): string {
  return `${item.id} · ${item.path} · ${item.restored ? labels.restored : item.after === undefined ? labels.unsealed : labels.ready}`
}
export async function checkpointCommand(raw: string, cwd: string, labels: Catalog['checkpoint'], running: boolean) {
  if (running) return { kind: 'handled' as const, message: labels.busy, failed: true }
  const repository = checkpointRepository(cwd)
  const match = /^\/checkpoint(?:\s+(\S+))?(?:\s+([\s\S]+))?$/.exec(raw.trim())
  const action = match?.[1] ?? 'list'
  const argument = match?.[2]?.trim() ?? ''
  try {
    let message: string
    if (action === 'list' && !argument) message = (await repository.list()).map(item => checkpointDescription(item, labels)).join('\n') || labels.empty
    else if (action === 'save' && argument) message = checkpointDescription(await repository.save(argument.replace(/^(["'])(.*)\1$/, '$2')), labels)
    else if (action === 'seal' && argument) message = checkpointDescription(await repository.seal(argument), labels)
    else if (action === 'show' || action === 'restore') {
      const args = argument.split(/\s+/)
      if (args.length > 2 || (args[1] !== undefined && (action !== 'restore' || args[1] !== 'confirm'))) throw new CheckpointError('invalid')
      if (action === 'restore' && args[1] === 'confirm') message = checkpointDescription(await repository.restore(args[0]), labels)
      else {
        const item = await repository.read(args[0])
        const decode = (value: typeof item.before) => value === null ? null : Buffer.from(value.data, 'base64').toString('utf8')
        const safeText = (value: typeof item.before) => {
          if (value === null) return true
          const bytes = Buffer.from(value.data, 'base64'), text = bytes.toString('utf8')
          return bytes.equals(Buffer.from(text, 'utf8')) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)
        }
        const diff = item.after === undefined ? labels.unsealed
          : !safeText(item.before) || !safeText(item.after) ? labels.binary
            : diffLines({ path: item.path, oldText: decode(item.before), newText: decode(item.after) ?? '' }).join('\n')
        message = `${checkpointDescription(item, labels)}\n${labels.preview}\n${diff}\n${action === 'restore' ? labels.confirm : ''}`
      }
    } else message = labels.usage
    return { kind: 'handled' as const, message }
  } catch (error) {
    return { kind: 'handled' as const, failed: true, message: error instanceof CheckpointError ? labels[error.code] : labels.failed }
  }
}
