/**
 * Reading and rewriting the user's patch layer, for the rows `/mcp` manages.
 *
 * `~/.dsh/cordis.patch.yml` is the machine-local layer every profile composes
 * last, and the launcher watches it: a row appended here is mounted by HMR
 * without a restart, and it is still there tomorrow. That is why `/mcp add`
 * writes a file rather than calling `loader.create()` — the loader's root tree
 * is in-memory and its `write()` is a no-op, so a live-only insert would
 * vanish on exit (SPEC §1.12).
 *
 * Everything goes through `parseDocument`, never `parse`+`stringify`. The file
 * belongs to the user: it holds their comments and their `!!js` expressions,
 * and a round trip that dropped either would be a data-loss bug dressed up as
 * a convenience. Editing the document tree preserves both.
 *
 * The path is resolved from `$DSH_HOME` the way the harness resolves it, which
 * is deliberately unlike this package's own `tui.json` (SPEC §1.12): the patch
 * layer is the harness' file, and a user who moved their harness home expects
 * `/mcp add` to follow it there.
 * @module @deepseek-ai/dsh-tui/mcp-patch
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { Document, isMap, isSeq, parseDocument, YAMLSeq } from 'yaml'
import { type McpPatchRow } from './mcp-config.ts'

/** Basename of the composed-last patch layer. */
export const PATCH_FILE = 'cordis.patch.yml'

/** Environment variable that relocates the harness home. */
const HOME_ENV = 'DSH_HOME'

/** Directory the dsh family keeps user-level state in, under the OS home. */
const DEFAULT_HOME_DIR = '.dsh'

/** The comment a file this command creates opens with. */
const HEADER = [
  ' The machine-local patch layer, composed over every profile.',
  ' `/mcp add` appends rows here; hand edits are preserved, including',
  ' comments and !!js expressions. The launcher watches this file, so a',
  ' change applies to the running session without a restart.',
].join('\n')

/**
 * Resolve the harness home.
 *
 * Mirrors the harness' own precedence — `$DSH_HOME`, then `~/.dsh` — including
 * the treatment of a blank override as unset, which otherwise resolves the
 * home to the working directory.
 * @param env - environment to read; defaults to the process'.
 * @param home - the OS home directory; defaults to the real one.
 * @returns the absolute harness home.
 */
export function dshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = env[HOME_ENV]
  if (override !== undefined && override.trim() !== '') {
    return isAbsolute(override) ? override : resolve(override)
  }
  return join(home, DEFAULT_HOME_DIR)
}

/**
 * Absolute path of the patch layer.
 * @param home - the harness home; defaults to the resolved one.
 * @returns the path, whether or not anything exists there.
 */
export function patchPath(home: string = dshHome()): string {
  return join(home, PATCH_FILE)
}

/** What a write attempt did, or why it did nothing. */
export type PatchResult =
  | { kind: 'written'; servers: string[] }
  | { kind: 'duplicate'; server: string }
  | { kind: 'missing'; server: string }
  | { kind: 'failed'; reason: string }

/**
 * Load the patch document, or say why it cannot be touched.
 *
 * A file that exists but does not parse, or that is not the top-level list a
 * patch layer must be, stops the command here. Rewriting it would destroy
 * whatever the user was in the middle of writing, and a `/mcp add` that
 * silently clobbers a config file is worse than one that refuses.
 * @param path - the patch file path.
 * @returns the document, or the refusal.
 */
function loadDocument(path: string): { doc: Document; seq: YAMLSeq } | { kind: 'failed'; reason: string } {
  let text: string | undefined
  try {
    text = readFileSync(path, { encoding: 'utf8' })
  } catch (error) {
    // Absent is the ordinary case — this layer is optional and most users have
    // never created it. Anything else (a directory, no permission) is not.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      const reason = error instanceof Error ? error.message : String(error)
      return { kind: 'failed', reason }
    }
  }
  if (text === undefined) {
    const doc = new Document(new YAMLSeq())
    doc.commentBefore = HEADER
    return { doc, seq: doc.contents as YAMLSeq }
  }
  // Widened from `Document.Parsed`: an empty or `[]` layer has its contents
  // replaced with a fresh block sequence, so appended rows read as block YAML
  // rather than being crammed into one flow line.
  const doc: Document = parseDocument(text)
  // `warnings` holds the unresolved `!!js` tags, which are expected here and
  // round-trip fine. Only `errors` means the text is not YAML.
  if (doc.errors.length > 0) {
    return { kind: 'failed', reason: doc.errors[0]?.message ?? 'unparsable YAML' }
  }
  if (doc.contents === null || (isSeq(doc.contents) && doc.contents.items.length === 0)) {
    const seq = new YAMLSeq()
    doc.contents = seq
    return { doc, seq }
  }
  if (!isSeq(doc.contents)) {
    return { kind: 'failed', reason: 'the patch layer is not a top-level list' }
  }
  return { doc, seq: doc.contents }
}

/**
 * Every server the file already configures, wherever its row sits.
 *
 * Keyed on the row's `config.serverName` rather than on its id, because the
 * bridge's namespace uniqueness is by name: a row someone hand-wrote under
 * `id: memory-engram` still owns the `engram` namespace, and adding a second
 * row for it would start a plugin the bridge refuses. Reading the name is
 * also what lets `/mcp remove` address a row this command did not write.
 * @param seq - the top-level patch list.
 * @returns the server names, in file order.
 */
function patchedServers(seq: YAMLSeq): string[] {
  const names: string[] = []
  for (const patch of seq.items) {
    if (!isMap(patch)) continue
    const insert = patch.get('insert')
    if (!isSeq(insert)) continue
    for (const row of insert.items) {
      if (!isMap(row)) continue
      const config = row.get('config')
      if (!isMap(config)) continue
      const name = config.get('serverName')
      if (typeof name === 'string') names.push(name)
    }
  }
  return names
}

/**
 * Append one patch per server to the layer.
 *
 * One patch per server rather than one patch holding all of them, so
 * `/mcp remove` can take a server away by deleting a whole element and never
 * has to rewrite a list someone else's row shares.
 * @param rows - the rows to add, from `parseMcpSnippet`.
 * @param path - the patch file; defaults to the resolved one.
 * @returns what happened.
 */
export function addMcpRows(rows: readonly McpPatchRow[], path: string = patchPath()): PatchResult {
  const loaded = loadDocument(path)
  if ('kind' in loaded) return loaded
  const { doc, seq } = loaded
  const present = new Set(patchedServers(seq))
  for (const row of rows) {
    if (present.has(row.config.serverName)) return { kind: 'duplicate', server: row.config.serverName }
  }
  for (const row of rows) {
    seq.add(doc.createNode({ insert: [row] }))
  }
  const written = write(path, doc)
  if (written !== undefined) return { kind: 'failed', reason: written }
  return { kind: 'written', servers: rows.map(row => row.config.serverName) }
}

/**
 * Take one server's row out of the layer.
 *
 * Addresses the row by the `serverName` in its config, so a server the user
 * wired up by hand is removable by the name `/mcp` lists it under — the
 * alternative is telling them to go edit YAML, which is the thing this command
 * exists to avoid. Removes the whole patch element when that leaves its
 * `insert` list empty: an empty `insert` is legal but is litter, and a user
 * reading the file should see their removal, not its residue.
 * @param serverName - the server to remove.
 * @param path - the patch file; defaults to the resolved one.
 * @returns what happened.
 */
export function removeMcpRow(serverName: string, path: string = patchPath()): PatchResult {
  const loaded = loadDocument(path)
  if ('kind' in loaded) return loaded
  const { doc, seq } = loaded
  let removed = false
  for (let index = seq.items.length - 1; index >= 0; index -= 1) {
    const patch = seq.items[index]
    if (!isMap(patch)) continue
    const insert = patch.get('insert')
    if (!isSeq(insert)) continue
    let emptied = false
    for (let at = insert.items.length - 1; at >= 0; at -= 1) {
      const row = insert.items[at]
      if (!isMap(row)) continue
      const config = row.get('config')
      if (!isMap(config) || config.get('serverName') !== serverName) continue
      insert.items.splice(at, 1)
      removed = true
      emptied = true
    }
    if (emptied && insert.items.length === 0 && patch.items.length === 1) {
      rescueComment(doc, seq, index)
      seq.items.splice(index, 1)
    }
  }
  if (!removed) return { kind: 'missing', server: serverName }
  const written = write(path, doc)
  if (written !== undefined) return { kind: 'failed', reason: written }
  return { kind: 'written', servers: [serverName] }
}

/**
 * The servers this layer configures, by name.
 * @param path - the patch file; defaults to the resolved one.
 * @returns the server names, or an empty list when the layer holds none.
 */
export function listPatchedServers(path: string = patchPath()): string[] {
  const loaded = loadDocument(path)
  if ('kind' in loaded) return []
  return patchedServers(loaded.seq)
}

/**
 * Move a doomed element's leading comment somewhere it survives.
 *
 * A comment written above the first row of a file parses as *that row's*
 * `commentBefore`, so removing the row takes the user's header with it — and
 * removing the last row would leave a bare `[]` where their file used to have
 * a name. The comment goes to the element that will take this one's place, or
 * to the document when there is none.
 * @param doc - the document being edited.
 * @param seq - the top-level patch list.
 * @param index - the element about to be spliced out.
 */
function rescueComment(doc: Document, seq: YAMLSeq, index: number): void {
  const doomed = seq.items[index]
  const comment = isMap(doomed) ? doomed.commentBefore : undefined
  if (comment === undefined || comment === null) return
  const heir = seq.items[index + 1]
  if (isMap(heir)) {
    heir.commentBefore = heir.commentBefore === undefined || heir.commentBefore === null
      ? comment
      : `${comment}\n${heir.commentBefore}`
    return
  }
  doc.commentBefore = doc.commentBefore === undefined || doc.commentBefore === null
    ? comment
    : `${comment}\n${doc.commentBefore}`
}

/**
 * Write the document out, replacing the file atomically.
 *
 * Temp-and-rename because the launcher is watching: a partial write would be
 * read as a broken patch layer and rejected, and the user would see a parse
 * failure they did not cause.
 * @param path - the patch file path.
 * @param doc - the document to serialise.
 * @returns undefined on success, or the failure's reason.
 */
function write(path: string, doc: Document): string | undefined {
  const temp = `${path}.tmp`
  try {
    mkdirSync(join(path, '..'), { recursive: true })
    // Nodes carry their own style, so a hand-written row keeps its shape. The
    // two options cover what a *fresh* node has no style for, chosen to match
    // the bundle patches: single quotes, and `[a, b]` without inner padding.
    // A round trip is faithful, not byte-exact — a flow list written
    // `[ mcp ]` comes back `[mcp]`.
    writeFileSync(temp, doc.toString({ singleQuote: true, flowCollectionPadding: false }), { encoding: 'utf8' })
    renameSync(temp, path)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
