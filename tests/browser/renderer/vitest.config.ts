import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({
  resolve: { alias: { '@': resolve('src/browser/source/renderer/src'), '@renderer': resolve('src/browser/source/renderer/src') } },
  define: { ORCA_BUILD_COMMIT: JSON.stringify('d3a843d032f602cf09e392613683a94089efce07') },
  test: { include: ['tests/browser/renderer/*.test.ts'], maxWorkers: 2 }
})
