import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({
  resolve: { alias: { '@': resolve('src/browser/source/renderer/src'), '@renderer': resolve('src/browser/source/renderer/src') } },
  define: { ORCA_BUILD_COMMIT: JSON.stringify('729f757b592244176420a86114c1ea23911eeeba') },
  test: { include: ['tests/browser/renderer/*.test.ts'], maxWorkers: 2 }
})
