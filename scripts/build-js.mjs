import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/cli.cjs',
  logLevel: 'info'
})

for (const [directory, file] of [['javis-linux', 'runtime.py'], ['javis-windows', 'runtime.ps1']]) {
  const target = join('dist', 'native', directory)
  await mkdir(target, { recursive: true })
  await copyFile(join('native', directory, file), join(target, file))
}

await mkdir(join('dist', 'skills', 'javis'), { recursive: true })
await copyFile(join('skills', 'javis', 'SKILL.md'), join('dist', 'skills', 'javis', 'SKILL.md'))
