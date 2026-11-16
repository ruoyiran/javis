import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { validateExistingJavisApp } from './install-local-policy.mjs'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'build', 'Javis.app')
const home = homedir()
const appDirectory = join(home, 'Applications')
const target = join(appDirectory, 'Javis.app')
const launcherDirectory = join(home, '.local', 'bin')
const launcher = join(launcherDirectory, 'javis')

if (!existsSync(source)) throw new Error('Build Javis.app with npm run build before installing')
run('codesign', ['--verify', '--deep', '--strict', source])
mkdirSync(appDirectory, { recursive: true })
mkdirSync(launcherDirectory, { recursive: true })
if (existsSync(launcher) && !readFileSync(launcher, 'utf8').startsWith('#!/bin/sh\n# Javis launcher\n')) {
  throw new Error(`Refusing to replace unrelated executable at ${launcher}`)
}
validateExistingJavisApp(target)

const builtNode = join(source, 'Contents', 'Resources', 'node')
const builtCli = join(source, 'Contents', 'Resources', 'cli.cjs')
const stop = spawnSync(builtNode, [builtCli, 'daemon', 'stop'], { encoding: 'utf8' })
if (stop.status !== 0) throw new Error(`Could not stop Javis daemon: ${stop.stderr || stop.stdout}`)

const staging = join(appDirectory, `.Javis.app.staging-${process.pid}`)
const backup = join(appDirectory, `.Javis.app.backup-${process.pid}`)
rmSync(staging, { recursive: true, force: true })
rmSync(backup, { recursive: true, force: true })
try {
  cpSync(source, staging, { recursive: true })
  run('codesign', ['--verify', '--deep', '--strict', staging])
  if (existsSync(target)) renameSync(target, backup)
  renameSync(staging, target)
  const quotedNode = shellQuote(join(target, 'Contents', 'Resources', 'node'))
  const quotedCli = shellQuote(join(target, 'Contents', 'Resources', 'cli.cjs'))
  writeFileSync(launcher, `#!/bin/sh\n# Javis launcher\nexec ${quotedNode} ${quotedCli} "$@"\n`, { mode: 0o755 })
  rmSync(backup, { recursive: true, force: true })
  run('codesign', ['--verify', '--deep', '--strict', target])
  console.log(`Installed ${target}\nCommand: ${launcher}`)
} catch (error) {
  if (!existsSync(target) && existsSync(backup)) renameSync(backup, target)
  throw error
} finally {
  rmSync(staging, { recursive: true, force: true })
}

function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'` }
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`)
}
