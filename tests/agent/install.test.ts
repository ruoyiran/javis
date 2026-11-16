import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

it('upgrades its own previously installed skill and keeps user edits protected', async () => {
  const { home, source } = fixture()
  const commandPath = '/usr/local/bin/javis'
  const run = async () => ({
    code: 0,
    stdout: `javis\n  command: ${commandPath}\n  args: mcp\n`,
    stderr: ''
  })
  await installAgent('codex', { home, skillSource: source, commandPath, run })
  writeFileSync(source, 'Javis skill v2')
  await installAgent('codex', { home, skillSource: source, commandPath, run })
  const target = join(home, '.agents', 'skills', 'javis', 'SKILL.md')
  expect(readFileSync(target, 'utf8')).toBe('Javis skill v2')
  writeFileSync(target, 'my modified skill')
  await expect(installAgent('codex', { home, skillSource: source, commandPath, run }))
    .rejects.toThrow(/existing.*skill/i)
})

it('refuses a managed manifest symlink without modifying its target', async () => {
  const { home, source } = fixture()
  const directory = join(home, '.agents', 'skills', 'javis')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), 'Javis skill')
  const outside = join(home, 'unrelated.txt')
  writeFileSync(outside, 'keep this')
  symlinkSync(outside, join(directory, '.javis-managed.json'))
  await expect(installAgent('codex', {
    home, skillSource: source, commandPath: '/usr/local/bin/javis',
    run: async () => ({ code: 0, stdout: 'javis\n  command: /usr/local/bin/javis\n  args: mcp\n', stderr: '' })
  })).rejects.toThrow(/manifest.*symlink/i)
  expect(readFileSync(outside, 'utf8')).toBe('keep this')
})
