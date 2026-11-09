/** Test/tooling types; the downloaded installer itself only needs install.mjs. */
export interface InstallOptions { home: string; profile: string; ref: string; package?: string; help?: boolean }
export interface InstallResult { target: string; backup?: string; launchPath: string; commit: string | null; artifactSha256: string }
export interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[]; [key: string]: unknown }; [key: string]: unknown }
  [key: string]: unknown
}
export const RUNTIME: string
export const OWNER: string
export function parseOptions(args: string[], env?: NodeJS.ProcessEnv): InstallOptions
export function startCommand(path: string, platform?: NodeJS.Platform): string
export function checkNode(version?: string): void
export function findNpmCli(env?: NodeJS.ProcessEnv): Promise<string>
export function run(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean; timeout?: number }): Promise<string>
export function profileManifest(previous: ProfileManifest, artifact: string): ProfileManifest & {
  dependencies: Record<string, string>
  dsh: { profile: { bundles: string[]; [key: string]: unknown } }
}
export function verifyProfile(profileDir: string, name: string, home: string, execute?: typeof run): Promise<void>
export function install(options: InstallOptions, dependencies?: { run?: typeof run; log?: (message: string) => void; npmCli?: string }): Promise<InstallResult>
