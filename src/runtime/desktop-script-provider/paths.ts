import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { JavisError } from '../error.js'

export type DesktopScriptPlatform = 'linux' | 'win32'

export function resolveDesktopScriptProviderPath(platform: DesktopScriptPlatform): string {
  const filename = platform === 'win32' ? 'runtime.ps1' : 'runtime.py'
  const directory = platform === 'win32' ? 'javis-windows' : 'javis-linux'
  const relative = join('native', directory, filename)
  const entryDirectory = dirname(process.argv[1] ?? process.cwd())
  const candidates = [
    process.env.JAVIS_DESKTOP_SCRIPT_PROVIDER_PATH,
    join(entryDirectory, relative),
    join(entryDirectory, '..', relative),
    join(process.cwd(), relative)
  ]
  const found = candidates.find((candidate) => candidate && existsSync(candidate))
  if (!found) {
    throw new JavisError('unsupported_capability', `Javis ${platform} desktop provider script is missing: ${relative}`)
  }
  return found
}
