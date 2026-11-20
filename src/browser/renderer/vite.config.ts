import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = dirname(fileURLToPath(import.meta.url))
export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwind()],
  resolve: { alias: { '@': resolve(root, '../source/renderer/src'), '@renderer': resolve(root, '../source/renderer/src'), '@shared': resolve(root, '../source/shared') } },
  define: { ORCA_BUILD_COMMIT: JSON.stringify('d3a843d032f602cf09e392613683a94089efce07'), ORCA_BUILD_IDENTITY: 'null', ORCA_POSTHOG_WRITE_KEY: 'null', ORCA_DIAGNOSTICS_TOKEN_URL: 'null' },
  build: { outDir: resolve(root, '../../../dist/browser/renderer'), emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' }
})
