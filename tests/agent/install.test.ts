import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installAgent } from '../../src/agent/install.js'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'javis-agent-test-'))
  folders.push(home)
  const source = join(home, 'source.md')
  writeFileSync(source, 'Javis skill', 'utf8')
  return { home, source }
}

it('refuses to replace an edited skill before touching agent configuration', async () => {
  const { home, source } = fixture()
  const target = join(home, '.agents', 'skills', 'javis')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'SKILL.md'), 'my edits')
  const commands: string[] = []
  await expect(installAgent('codex', {
    home, skillSource: source, commandPath: '/usr/local/bin/javis',
    run: async (command) => { commands.push(command); return { code: 1, stdout: '', stderr: '' } }
  })).rejects.toThrow(/existing.*skill/i)
  expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).toBe('my edits')
  expect(commands).toEqual([])
})

it('installs a skill and registers a missing Codex MCP server', async () => {
  const { home, source } = fixture()
  const commands: string[][] = []
  await installAgent('codex', {
    home, skillSource: source, commandPath: '/usr/local/bin/javis',
    run: async (command, args) => {
      commands.push([command, ...args])
      return { code: args[1] === 'get' ? 1 : 0, stdout: '', stderr: '' }
    }
  })
  expect(readFileSync(join(home, '.agents', 'skills', 'javis', 'SKILL.md'), 'utf8')).toBe('Javis skill')
  expect(commands).toContainEqual(['codex', 'mcp', 'add', 'javis', '--', '/usr/local/bin/javis', 'mcp'])
})

it('rejects a same-path MCP registration that would launch help instead of the server', async () => {
  const { home, source } = fixture()
  await expect(installAgent('codex', {
    home, skillSource: source, commandPath: '/usr/local/bin/javis',
    run: async () => ({
      code: 0,
      stdout: 'javis\n  command: /usr/local/bin/javis\n  args: -\n',
      stderr: ''
    })
  })).rejects.toThrow(/existing.*MCP/i)
})
