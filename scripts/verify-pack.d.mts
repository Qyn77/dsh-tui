export function exportProblems(exports: unknown, paths: string[]): string[]
export function importProblems(file: string, code: string, paths: string[]): string[]
export function packedPaths(directory?: string, npmCli?: string,
  execute?: (file: string, args: string[], options: { cwd: string; encoding: string; stdio: string[] }) => string): Promise<string[]>
