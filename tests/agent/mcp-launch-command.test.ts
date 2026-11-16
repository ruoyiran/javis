import { expect, test } from 'vitest'
import { mcpLaunchCommand } from '../../src/agent/mcp-launch-command.js'

test('registers the bundled CLI through node.exe on Windows', () => {
  expect(mcpLaunchCommand(
    'win32',
    'C:\\Users\\Alice\\AppData\\Local\\Javis\\bin\\javis.cmd',
    'C:\\Users\\Alice\\AppData\\Local\\Javis\\app\\skills\\javis\\SKILL.md',
    'C:\\Program Files\\nodejs\\node.exe'
  )).toEqual({
    command: 'C:\\Program Files\\nodejs\\node.exe',
    args: ['C:\\Users\\Alice\\AppData\\Local\\Javis\\app\\cli.cjs', 'mcp']
  })
})
