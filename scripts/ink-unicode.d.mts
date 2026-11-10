export function patchInkOutput(code: string, version: string): string
export function inkUnicode(): {
  name: string
  enforce: 'pre'
  transform(code: string, id: string): { code: string; map: null } | null
}
