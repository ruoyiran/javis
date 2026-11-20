import { platform, arch } from 'node:os'
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDependencyBinaryExecutable } from './agent-browser-dependency-binary'
import { agentBrowserDependencyBinaryPath } from "../../../../shared/orcad-agent-browser-name"

export function agentBrowserNativeName(): string {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return `agent-browser-${platform()}-${arch()}${ext}`
}

export function resolveAgentBrowserBinary(): string {
  // resourcesPath preserves the case-sensitive macOS Resources path.
  const bundledResourcesPath =
    process.resourcesPath ??
    (process.platform === 'darwin'
      ? join(app.getPath('exe'), '..', '..', 'Resources')
      : join(app.getPath('exe'), '..', 'resources'))
  const bundled = join(bundledResourcesPath, agentBrowserNativeName())
  if (existsSync(bundled)) {
    return bundled
  }

  // Bundling makes __dirname unreliable for locating development dependencies.
  const nmBin = join(
    app.getAppPath(),
    ...agentBrowserDependencyBinaryPath(process.platform, arch())
  )
  if (existsSync(nmBin)) {
    return nmBin
  }

  try {
    const packagePath = require.resolve('agent-browser/package.json')
    const target = agentBrowserDependencyBinaryPath(process.platform, arch())
    try {
      const manifest = require.resolve(`${target[1]}/${target[2]}/package.json`)
      const native = join(manifest, '..', 'bin', target.at(-1)!)
      if (existsSync(native)) { ensureDependencyBinaryExecutable(native); return native }
    } catch {}
    const installed = join(packagePath, '..', 'bin', agentBrowserNativeName())
    if (existsSync(installed)) { ensureDependencyBinaryExecutable(installed); return installed }
  } catch {}
  return 'agent-browser'
}
