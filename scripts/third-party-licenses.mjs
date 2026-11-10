import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

/** Resolve the owning package, including pnpm's physical dependency paths. */
function packageDirectory(id) {
  if (!id.replaceAll('\\', '/').includes('/node_modules/')) return undefined
  let directory = dirname(id.split('?')[0])
  while (directory !== parse(directory).root) {
    if (existsSync(join(directory, 'package.json'))) return directory
    directory = dirname(directory)
  }
}

/** Only modules present in emitted chunks contribute notices; externals do not. */
export function thirdPartyLicenses() {
  return {
    name: 'dsh-third-party-licenses',
    generateBundle(_options, bundle) {
      const packages = new Map()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of Object.keys(chunk.modules)) {
          const directory = packageDirectory(id)
          if (!directory || packages.has(directory)) continue
          const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
          const files = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name)
            && statSync(join(directory, name)).isFile()).sort()
          let notices = files.map(name => `${name}\n${readFileSync(join(directory, name), 'utf8').trim()}\n`).join('\n')
          // Version 0.1.3 declares MIT but omits LICENSE from its npm tarball.
          // Preserve the upstream notice verbatim; an upgrade must be reviewed.
          if (!notices && manifest.name === '@alcalzone/ansi-tokenize' && manifest.version === '0.1.3' && manifest.license === 'MIT') {
            notices = 'Upstream notice: https://github.com/AlCalzone/ansi-tokenize/blob/master/LICENSE\n'
              + readFileSync(new URL('./licenses/ansi-tokenize-0.1.3-LICENSE.txt', import.meta.url), 'utf8')
          }
          if (!notices) throw new Error(`Bundled package ${manifest.name} has no license notice`)
          packages.set(directory, `${manifest.name}@${manifest.version}\nLicense: ${manifest.license ?? 'see notice'}\n\n`
            + notices)
        }
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt',
        source: 'Third-party code included in this distribution\n\n' + [...packages.values()].sort().join('\n' + '='.repeat(72) + '\n\n') })
    },
  }
}
