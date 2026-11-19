import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, realpathSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { selectNodeRuntime } from './select-node-runtime.mjs'
import { packageBrowserMacOS } from './package-browser-macos.mjs'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const app = join(root, 'build', 'Javis.app')
const macos = join(app, 'Contents', 'MacOS')
const resources = join(app, 'Contents', 'Resources')
const helper = join(root, 'native', 'javis-macos', '.build', 'release', 'javis-helper')
const cli = join(root, 'dist', 'cli.cjs')
const identity = process.env.JAVIS_SIGN_IDENTITY ?? developmentIdentity()
const nodeRuntime = selectNodeRuntime()

if (!existsSync(helper) || !existsSync(cli)) throw new Error('Build Swift and TypeScript before packaging')
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Javis packaging requires arm64 or x64 macOS')
if (!identity || identity === '-') throw new Error('An Apple Development signing identity is required for local installation')

rmSync(app, { recursive: true, force: true })
mkdirSync(macos, { recursive: true })
mkdirSync(join(resources, 'skills', 'javis'), { recursive: true })
mkdirSync(join(resources, 'licenses'), { recursive: true })
copyFileSync(helper, join(macos, 'javis-helper'))
copyFileSync(nodeRuntime, join(resources, 'node'))
copyFileSync(cli, join(resources, 'cli.cjs'))
copyFileSync(join(root, 'assets', 'branding', 'Javis.icns'), join(resources, 'Javis.icns'))
copyFileSync(join(root, 'skills', 'javis', 'SKILL.md'), join(resources, 'skills', 'javis', 'SKILL.md'))
copyFileSync(join(root, 'LICENSE'), join(resources, 'licenses', 'orca-LICENSE'))
const nodeLicense = join(dirname(dirname(realpathSync(nodeRuntime))), 'LICENSE')
if (!existsSync(nodeLicense)) throw new Error(`Bundled Node license not found: ${nodeLicense}`)
copyFileSync(nodeLicense, join(resources, 'licenses', 'node-LICENSE'))
copyPackageLicenses(join(root, 'node_modules'), join(resources, 'licenses', 'npm'))
packageBrowserMacOS({ source: join(root, 'dist/browser'), destination: join(resources, 'browser'), identity, version, entitlements: join(root, 'scripts/browser-macos-entitlements.plist') })
chmodSync(join(macos, 'javis-helper'), 0o755)
chmodSync(join(resources, 'node'), 0o755)
writeFileSync(join(app, 'Contents', 'Info.plist'), infoPlist(version))
run('codesign', ['--force', '--sign', identity, '--identifier', 'com.royran.javis.node', join(resources, 'node')])
run('codesign', ['--force', '--sign', identity, '--identifier', 'com.royran.javis', app])
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
console.log(app)

function developmentIdentity() {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'Cannot inspect signing identities')
  return result.stdout.match(/"([^"]*Apple Development:[^"]+)"/)?.[1]
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`)
}

function copyPackageLicenses(source, target) {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === '.bin') continue
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) copyPackageLicenses(from, to)
    else if (/^(license|copying|notice)(\..+)?$/i.test(entry.name)) {
      mkdirSync(target, { recursive: true })
      copyFileSync(from, to)
    }
  }
}

function infoPlist(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.royran.javis</string>
<key>CFBundleExecutable</key><string>javis-helper</string>
<key>CFBundleName</key><string>Javis</string>
<key>CFBundleDisplayName</key><string>Javis</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>Javis</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSAccessibilityUsageDescription</key><string>Javis needs Accessibility permission to inspect and operate apps you ask it to use.</string>
<key>NSScreenCaptureUsageDescription</key><string>Javis needs Screen Recording permission to capture windows you ask it to inspect.</string>
</dict></plist>\n`
}
