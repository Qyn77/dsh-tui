import { defineConfig } from 'vitest/config'
import { inkUnicode } from './scripts/ink-unicode.mjs'

export default defineConfig({
  plugins: [inkUnicode()],
  test: {
    server: { deps: { inline: ['ink'] } },
    include: ['tests/**/*.spec.ts'],
    exclude: ['node_modules', 'lib', 'dist', '**/node_modules/**'],
  },
})
