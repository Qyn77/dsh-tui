import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    exclude: ['node_modules', 'lib', 'dist', '**/node_modules/**'],
  },
})
