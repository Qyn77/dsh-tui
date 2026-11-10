import { describe, expect, it, vi } from 'vitest'
import { exportProblems, importProblems, packedPaths } from '../scripts/verify-pack.mjs'

describe('published package contract', () => {
  it('rejects missing static and optional dynamic chunks without matching comments or strings', () => {
    const code = `import './runtime.js'; export { x } from './shared.js';
      if (process.env.DEV) import('./devtools.js');
      const example = "import './not-code.js'"; // import './comment.js'
      import React from 'react';`
    expect(importProblems('lib/index.js', code, ['lib/index.js', 'lib/shared.js']))
      .toEqual(['missing local import: lib/index.js -> ./runtime.js', 'missing local import: lib/index.js -> ./devtools.js'])
    expect(importProblems('lib/index.js', code, ['lib/index.js', 'lib/shared.js', 'lib/runtime.js', 'lib/devtools.js'])).toEqual([])
  })
  it('rejects an advertised source wildcard when the tarball omits source', () => {
    expect(exportProblems({ './src/*': './src/*' }, ['lib/index.js']))
      .toEqual(['export target has no packaged files: ./src/*'])
  })

  it('checks every conditional export and allows explicit blocked exports', () => {
    expect(exportProblems({ '.': { types: './lib/index.d.ts', default: './lib/index.js' }, './private': null }, ['lib/index.js']))
      .toEqual(['missing exported entry: ./lib/index.d.ts'])
  })

  it('accepts packaged exact and wildcard targets', () => {
    expect(exportProblems({ '.': './lib/index.js', './features/*': './lib/*.js' }, ['lib/index.js', 'lib/extra.js']))
      .toEqual([])
  })

  it('launches npm through Node so Windows does not execute npm.cmd', async () => {
    const execute = vi.fn(() => JSON.stringify([{ files: [{ path: 'package.json' }] }]))
    expect(await packedPaths('/fixture', '/Node With Spaces/npm-cli.js', execute)).toEqual(['package.json'])
    expect(execute).toHaveBeenCalledWith(process.execPath,
      ['/Node With Spaces/npm-cli.js', 'pack', '--dry-run', '--json', '--ignore-scripts'],
      expect.objectContaining({ cwd: '/fixture' }))
  })
})
