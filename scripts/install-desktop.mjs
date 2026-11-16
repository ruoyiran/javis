import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'dist')
const windows = process.platform === 'win32'
const home = homedir()
const installRoot = windows
  ? win32.join(process.env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'Javis')
  : join(home, '.local', 'share', 'javis')
const app = windows ? win32.join(installRoot, 'app') : installRoot
const launcherDirectory = windows ? win32.join(installRoot, 'bin') : join(home, '.local', 'bin')
const launcher = join(launcherDirectory, windows ? 'javis.cmd' : 'javis')
const staging = `${app}.staging-${process.pid}`
const backup = `${app}.backup-${process.pid}`
const cli = join(source, 'cli.cjs')

if (!existsSync(cli) || !existsSync(join(source, 'native', 'javis-linux', 'runtime.py')) ||
    !existsSync(join(source, 'native', 'javis-windows', 'runtime.ps1'))) {
  throw new Error('Build Javis with npm run build before installing')
}
mkdirSync(launcherDirectory, { recursive: true })
mkdirSync(windows ? installRoot : join(home, '.local', 'share'), { recursive: true })
if (existsSync(launcher)) {
  const marker = windows ? '@echo off\r\nREM Javis launcher\r\n' : '#!/bin/sh\n# Javis launcher\n'
  if (!readFileSync(launcher, 'utf8').startsWith(marker)) throw new Error(`Refusing to replace unrelated launcher at ${launcher}`)
}
if (existsSync(join(app, 'cli.cjs'))) {
  const stopped = spawnSync(process.execPath, [join(app, 'cli.cjs'), 'daemon', 'stop'], { encoding: 'utf8', windowsHide: true })
  if (stopped.status !== 0) throw new Error(`Could not stop Javis daemon: ${stopped.stderr || stopped.stdout}`)
}
rmSync(staging, { recursive: true, force: true })
rmSync(backup, { recursive: true, force: true })
try {
  cpSync(source, staging, { recursive: true })
  mkdirSync(join(staging, 'licenses'), { recursive: true })
  copyFileSync(join(root, 'LICENSE'), join(staging, 'licenses', 'orca-LICENSE'))
  if (existsSync(app)) renameSync(app, backup)
  renameSync(staging, app)
  const executable = process.execPath
  if (windows) {
    writeFileSync(launcher, `@echo off\r\nREM Javis launcher\r\n"${executable}" "${join(app, 'cli.cjs')}" %*\r\n`)
  } else {
    writeFileSync(launcher, `#!/bin/sh\n# Javis launcher\nexec ${quote(executable)} ${quote(join(app, 'cli.cjs'))} "$@"\n`, { mode: 0o755 })
  }
  rmSync(backup, { recursive: true, force: true })
  console.log(`Installed Javis at ${app}\nCommand: ${launcher}`)
} catch (error) {
  if (!existsSync(app) && existsSync(backup)) renameSync(backup, app)
  throw error
} finally {
  rmSync(staging, { recursive: true, force: true })
}

function quote(value) { return `'${value.replaceAll("'", "'\\''")}'` }
