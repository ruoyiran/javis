import { build } from 'esbuild'
import { access, chmod, copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'src/browser')
const output = join(root, 'dist/browser')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
await mkdir(output, { recursive: true })

const nodeOptions = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', 'node-pty'],
  define: { 'import.meta.env': JSON.stringify({ DEV: false, PROD: true, MODE: 'production' }) },
  loader: { '.svg': 'text' },
  logLevel: 'info'
}

await build({
  ...nodeOptions,
  entryPoints: [join(source, 'main/main.ts')],
  outfile: join(output, 'main/main.cjs'),
  define: { ...nodeOptions.define, 'import.meta.url': '__javisImportMetaUrl', 'import.meta.dirname': '__dirname', 'import.meta.filename': '__filename' },
  banner: { js: "var __javisImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" }
})

for (const [entry, file] of [
  ['javis-browser.ts', 'javis-browser.cjs'],
  ['browser-guest.ts', 'browser-guest-preload.cjs'],
  ['doc-preview-link.ts', 'doc-preview-link-preload.cjs']
]) await build({ ...nodeOptions, entryPoints: [join(source, 'source/preload', entry)], outfile: join(output, 'preload', file) })

await build({ ...nodeOptions, entryPoints: [join(source, 'source/preload/browser-extension-preload.ts')], outfile: join(output, 'main/browser-extension-preload.js') })
for (const [entry, file] of [
  ['browser-extension-worker-shim.ts', 'orca-extension-api.js'],
  ['browser-extension-content-script-api.ts', 'orca-content-script-api.js']
]) await build({ bundle: true, platform: 'browser', target: 'es2022', format: 'iife', entryPoints: [join(source, 'source/preload', entry)], outfile: join(output, 'main', file), logLevel: 'info' })

await build({ ...nodeOptions, entryPoints: [join(source, 'source/main/browser/extensions/native-messaging/browser-extension-native-host-supervisor-entry.ts')], outfile: join(output, 'main/browser-extension-native-host-supervisor-entry.cjs') })
await writeFile(join(output, 'package.json'), JSON.stringify({ name: 'javis-browser', version, private: true, main: 'main/main.cjs' }, null, 2) + '\n')

const vite = join(root, 'node_modules/vite/bin/vite.js')
const renderer = spawnSync(process.execPath, [vite, 'build', '--config', join(source, 'renderer/vite.config.ts')], { cwd: root, stdio: 'inherit', windowsHide: true })
if (renderer.error) throw renderer.error
if (renderer.status !== 0) process.exit(renderer.status ?? 1)

const require = createRequire(import.meta.url)
const electronPackage = dirname(require.resolve('electron/package.json'))
const electronDist = join(electronPackage, 'dist')
const executable = process.platform === 'darwin' ? join(electronDist, 'Electron.app/Contents/MacOS/Electron') : join(electronDist, process.platform === 'win32' ? 'electron.exe' : 'electron')
try { await access(executable) }
catch {
  const install = spawnSync(process.execPath, [join(electronPackage, 'install.js')], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (install.error) throw install.error
  if (install.status !== 0) throw new Error('The pinned Electron browser runtime could not be installed')
}
await cp(electronDist, join(output, 'electron'), { recursive: true, verbatimSymlinks: true })
const resources = process.platform === 'darwin' ? join(output, 'electron/Electron.app/Contents/Resources') : join(output, 'electron/resources')
await mkdir(resources, { recursive: true })
const nativeName = `agent-browser-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
const agentPackage = dirname(require.resolve('agent-browser/package.json'))
await copyFile(join(agentPackage, 'bin', nativeName), join(resources, nativeName))
if (process.platform !== 'win32') await chmod(join(resources, nativeName), 0o755)
if (process.platform === 'win32') await import('./build-browser-windows.mjs')
