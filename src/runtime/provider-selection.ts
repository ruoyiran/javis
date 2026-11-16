import { JavisError } from './error.js'
import { createMacOSProvider } from './macos-provider.js'
import { createDesktopScriptProvider } from './desktop-script-provider/client.js'
import type { JavisProvider } from './provider.js'

export function createProviderForPlatform(
  platform: NodeJS.Platform,
  options: { canDeliver?: () => boolean; stateDirectory?: string } = {}
): JavisProvider {
  if (platform === 'darwin') return createMacOSProvider(options)
  if (platform === 'linux' || platform === 'win32') {
    return createDesktopScriptProvider(platform, { canDeliver: options.canDeliver })
  }
  throw new JavisError('unsupported_platform', `Javis computer use is unsupported on ${platform}`)
}
