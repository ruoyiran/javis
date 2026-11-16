import { expect, test } from 'vitest'
import { resolveAgentInstallPaths } from '../../src/agent/install-paths.js'

test('locates each platform installation without an Orca path', () => {
  expect(resolveAgentInstallPaths('darwin', '/Users/alice', {}).commandPath).toBe('/Users/alice/.local/bin/javis')
  expect(resolveAgentInstallPaths('linux', '/home/alice', {}).skillSource).toBe('/home/alice/.local/share/javis/skills/javis/SKILL.md')
  expect(resolveAgentInstallPaths('win32', 'C:\\Users\\Alice', { LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local' })).toEqual({
    commandPath: 'C:\\Users\\Alice\\AppData\\Local\\Javis\\bin\\javis.cmd',
    skillSource: 'C:\\Users\\Alice\\AppData\\Local\\Javis\\app\\skills\\javis\\SKILL.md'
  })
})
