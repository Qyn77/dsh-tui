export function thirdPartyLicenses(): {
  name: string
  generateBundle(this: { emitFile(asset: { type: 'asset'; fileName: string; source: string }): unknown },
    options: unknown, bundle: Record<string, { type: string; modules?: Record<string, unknown> }>): void
}
