import { posix, win32 } from 'node:path'
import { JavisError } from '../runtime/error.js'

export function resolveAgentInstallPaths(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv
): { commandPath: string; skillSource: string } {
  if (platform === 'darwin') return {
    commandPath: posix.join(home, '.local/bin/javis'),
    skillSource: posix.join(env.JAVIS_APP_PATH ?? posix.join(home, 'Applications/Javis.app'), 'Contents/Resources/skills/javis/SKILL.md')
  }
  if (platform === 'linux') return {
    commandPath: posix.join(home, '.local/bin/javis'),
    skillSource: posix.join(home, '.local/share/javis/skills/javis/SKILL.md')
  }
  if (platform === 'win32') {
    const root = win32.join(env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'Javis')
    return {
      commandPath: win32.join(root, 'bin', 'javis.cmd'),
      skillSource: win32.join(root, 'app', 'skills', 'javis', 'SKILL.md')
    }
  }
  throw new JavisError('unsupported_platform', `Javis agent installation is unsupported on ${platform}`)
}
