import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function packageBrowserMacOS({ source, destination, identity, version, entitlements }) {
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true, filter: file => !file.startsWith(join(source, 'electron')) })
  const app = join(destination, 'Javis Browser.app')
  cpSync(join(source, 'electron/Electron.app'), app, { recursive: true, verbatimSymlinks: true })
  const contents = join(app, 'Contents')
  renameSync(join(contents, 'MacOS/Electron'), join(contents, 'MacOS/Javis Browser'))
  const plist = join(contents, 'Info.plist')
  let text = readFileSync(plist, 'utf8')
  for (const [key, value] of Object.entries({
    CFBundleExecutable: 'Javis Browser', CFBundleName: 'Javis Browser', CFBundleDisplayName: 'Javis Browser',
    CFBundleIdentifier: 'com.royran.javis.browser', CFBundleShortVersionString: version, CFBundleVersion: version
  })) {
    const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`)
    text = pattern.test(text) ? text.replace(pattern, `$1${value}$2`) : text.replace('</dict>', `<key>${key}</key><string>${value}</string>\n</dict>`)
  }
  writeFileSync(plist, text)
  rmSync(join(app, 'Contents/_CodeSignature'), { recursive: true, force: true })
  const sign = (file, runtime = false) => {
    const args = ['--force', '--sign', identity]
    if (runtime) args.push('--options', 'runtime', '--entitlements', entitlements)
    args.push(file)
    const result = spawnSync('codesign', args, { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Browser signing failed: ${file}`)
  }
  function libraries(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) libraries(file)
      else if (/\.(dylib|so|node)$/.test(entry.name)) sign(file)
    }
  }
  const frameworks = join(contents, 'Frameworks')
  libraries(frameworks)
  for (const entry of readdirSync(frameworks).filter(name => name.endsWith('.framework'))) sign(join(frameworks, entry))
  for (const entry of readdirSync(frameworks).filter(name => name.endsWith('.app'))) sign(join(frameworks, entry), true)
  const native = join(contents, 'Resources', `agent-browser-darwin-${process.arch}`)
  if (!existsSync(native)) throw new Error('The packaged browser automation binary is missing')
  sign(native)
  sign(app, true)
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' })
  if (verify.status !== 0) throw new Error('The signed browser bundle did not verify')
}
