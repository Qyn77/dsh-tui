import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const inkRoot = dirname(dirname(require.resolve('ink')))
const inkVersion = JSON.parse(readFileSync(join(inkRoot, 'package.json'), 'utf8')).version
const outputPath = join(inkRoot, 'build/output.js').replaceAll('\\', '/')

// Kept at the build boundary: npm consumers receive the corrected renderer,
// without an install hook or a mutation of their shared Ink installation.
const helpers = `
const dshSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function dshGraphemeCells(line) {
    const chars = styledCharsFromTokens(tokenize(line));
    const plain = chars.map(char => char.value).join('');
    const cells = [];
    let at = 0;
    let prefix = [];
    for (const { segment } of dshSegmenter.segment(plain)) {
        const members = [];
        let length = 0;
        while (at < chars.length && length < segment.length) {
            const char = chars[at++];
            members.push(char);
            length += char.value.length;
        }
        const width = stringWidth(segment);
        if (width === 0) {
            prefix.push(...members);
            continue;
        }
        members.unshift(...prefix);
        prefix = [];
        const styles = members[0].styles;
        const sameStyle = members.every(char => char.styles.length === styles.length
            && char.styles.every((style, index) => style === styles[index]));
        cells.push({ type: 'char', fullWidth: width === 2, width,
            value: sameStyle ? members.map(char => char.value).join('') : styledCharsToString(members),
            styles: sameStyle ? styles : [] });
    }
    if (prefix.length && cells.length) {
        const last = cells[cells.length - 1];
        last.value = styledCharsToString([last]) + styledCharsToString(prefix);
        last.styles = [];
    }
    return cells;
}
function dshSliceColumns(line, from, to) {
    const cells = [];
    let column = 0;
    for (const cell of dshGraphemeCells(line)) {
        const end = column + cell.width;
        const visible = Math.max(0, Math.min(end, to) - Math.max(column, from));
        if (visible) cells.push(visible === cell.width ? cell
            : { ...cell, value: ' '.repeat(visible), fullWidth: false, width: visible });
        column = end;
        if (column >= to) break;
    }
    return styledCharsToString(cells);
}
`

export function patchInkOutput(code, version) {
  if (version !== '5.2.1') throw new Error(`Ink Unicode compatibility patch requires 5.2.1, received ${version}`)
  const changes = [
    ["import sliceAnsi from 'slice-ansi';", ''],
    ['export default class Output {', `${helpers}\nexport default class Output {`],
    ['return sliceAnsi(line, from, to);', 'return dshSliceColumns(line, from, to);'],
    ['const characters = styledCharsFromTokens(tokenize(line));', 'const characters = dshGraphemeCells(line);'],
    ['const isWideCharacter = character.fullWidth || character.value.length > 1;', 'const isWideCharacter = character.width === 2;'],
    ['offsetX += isWideCharacter ? 2 : 1;', 'offsetX += character.width;'],
  ]
  for (const [before, after] of changes) {
    if (code.split(before).length !== 2) throw new Error(`Ink output implementation changed at: ${before}`)
    code = code.replace(before, after)
  }
  return code
}

export function inkUnicode() {
  return {
    name: 'dsh-ink-unicode',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0].replaceAll('\\', '/') !== outputPath) return null
      return { code: patchInkOutput(code, inkVersion), map: null }
    },
  }
}
