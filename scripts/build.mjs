import { spawnSync } from 'node:child_process'

run('node', ['scripts/build-js.mjs'])
if (process.platform === 'darwin') {
  run('node', ['scripts/build-native.mjs'])
  run('node', ['scripts/package-macos.mjs'])
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
