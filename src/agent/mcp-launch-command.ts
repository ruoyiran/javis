import { win32 } from 'node:path'

export function mcpLaunchCommand(
  platform: NodeJS.Platform,
  commandPath: string,
  skillSource: string,
  nodeExecutable: string
): { command: string; args: string[] } {
  if (platform === 'win32') return {
    command: nodeExecutable,
    args: [win32.join(win32.dirname(skillSource), '..', '..', 'cli.cjs'), 'mcp']
  }
  return { command: commandPath, args: ['mcp'] }
}
