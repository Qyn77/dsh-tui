/** Test/tooling types; the downloaded installer itself only needs install.mjs. */
export interface InstallOptions { home: string; profile: string; ref: string; package?: string; help?: boolean; noPath?: boolean; check?: boolean }
export interface InstallResult { target: string; backup?: string; launchPath: string; commit: string | null; artifactSha256: string; commandReady: boolean }
export interface CommandPlan { platform: NodeJS.Platform; bin: string; command: string; configs: string[]; shell: string }
export interface InstallerDependencies {
  run?: typeof run; log?: (message: string) => void; npmCli?: string
  platform?: NodeJS.Platform; arch?: string; nodeVersion?: string
  userHome?: string; env?: NodeJS.ProcessEnv; tempDir?: string
  statfs?: (path: string) => Promise<{ bavail: number; bsize: number }>
}
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
export function pathBlock(previous: string, bin: string, shell?: string): string
export function commandPlan(options: InstallOptions, system?: InstallerDependencies): Promise<CommandPlan | null>
export function preflight(options: InstallOptions, dependencies?: InstallerDependencies): Promise<CommandPlan | null>
export function configureCommand(plan: CommandPlan | null, launchPath: string, dependencies?: { run?: typeof run; node?: string }): Promise<void>
export function install(options: InstallOptions, dependencies?: InstallerDependencies): Promise<InstallResult>
