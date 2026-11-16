import { existsSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function validateExistingJavisApp(path) {
  if (!existsSync(path)) return
  const entry = lstatSync(path)
  if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid()) {
    throw new Error(`Refusing to replace an unrelated app at ${path}`)
  }
  const plist = join(path, 'Contents', 'Info.plist')
  const bundle = spawnSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist], { encoding: 'utf8' })
  if (bundle.status !== 0 || bundle.stdout.trim() !== 'com.royran.javis') {
    throw new Error(`Refusing to replace an unrelated app at ${path}`)
  }
  const signature = spawnSync('codesign', ['--verify', '--deep', '--strict', path], { encoding: 'utf8' })
  if (signature.status !== 0) throw new Error(`Existing Javis app has an invalid signature: ${path}`)
}
