import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  resolve: { alias: {
    '@': resolve(root, 'src/browser/source/renderer/src'),
    '@renderer': resolve(root, 'src/browser/source/renderer/src'),
    '@shared': resolve(root, 'src/browser/source/shared')
  } },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/browser/**/vitest.config.ts'] }
})
