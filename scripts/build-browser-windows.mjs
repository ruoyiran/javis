import { parsePatch, applyPatch, reversePatch } from 'diff'
import { readFile, writeFile, mkdir, cp, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

if (process.platform === 'win32') {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const require = createRequire(import.meta.url)
  const { version: electronVersion } = JSON.parse(await readFile(require.resolve('electron/package.json'), 'utf8'))
  const ptyRoot = dirname(require.resolve('node-pty/package.json'))
  const patch = await readFile(join(root, 'native/javis-browser-windows/node-pty-1.1.0.patch'), 'utf8')
  for (const change of parsePatch(patch)) {
    const name = change.newFileName.replace(/^b\//, '')
    const file = resolve(ptyRoot, name)
    const outside = relative(ptyRoot, file)
    if (isAbsolute(outside) || outside.startsWith('..')) throw new Error('The browser native patch escaped its package')
    const current = await readFile(file, 'utf8')
    const patched = applyPatch(current, change)
    if (patched === false) {
      if (applyPatch(current, reversePatch(change)) === false) throw new Error(`Pinned node-pty source does not match its browser patch: ${name}`)
    } else await writeFile(file, patched)
  }
  const gyp = require.resolve('node-gyp/bin/node-gyp.js')
  const build = directory => {
    const result = spawnSync(process.execPath, [gyp, 'rebuild', '--directory', directory, '--target', electronVersion, '--arch', process.arch, '--dist-url', 'https://electronjs.org/headers'], { cwd: root, stdio: 'inherit', windowsHide: true })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Browser native build failed: ${directory}`)
  }
  build(ptyRoot)
  const output = join(root, 'dist/browser')
  await mkdir(join(output, 'node_modules'), { recursive: true })
  const ptyDestination = join(output, 'node_modules/node-pty')
  await mkdir(ptyDestination, { recursive: true })
  for (const name of ['lib', 'build/Release']) await cp(join(ptyRoot, name), join(ptyDestination, name), { recursive: true, verbatimSymlinks: true })
  for (const name of ['package.json', 'LICENSE']) await copyFile(join(ptyRoot, name), join(ptyDestination, name))
  for (const name of ['windows-security', 'windows-registry']) {
    const source = join(root, 'src/browser/source/main/windows', name)
    build(source)
    const destination = join(output, 'main', name)
    await mkdir(destination, { recursive: true })
    await copyFile(join(source, 'index.js'), join(destination, 'index.cjs'))
    await copyFile(join(source, 'index.js'), join(destination, 'index.js'))
    await cp(join(source, 'build/Release'), join(destination, 'build/Release'), { recursive: true })
  }
}
