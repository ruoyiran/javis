import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('Javis native build requires arm64 or x64 macOS')
}
const result = spawnSync('swift', [
  'build', '-c', 'release', '--package-path', 'native/javis-macos'
], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
