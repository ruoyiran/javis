import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Agent = 'codex' | 'claude'
type Result = { code: number; stdout: string; stderr: string }
type Options = {
  home?: string
  skillSource?: string
  commandPath?: string
  run?: (command: string, args: string[]) => Promise<Result>
}

function registeredJavisCommand(agent: Agent, output: string, commandPath: string): boolean {
  const command = /^\s*command:\s*(.+)\s*$/im.exec(output)?.[1]?.trim()
  const args = /^\s*args:\s*(.+)\s*$/im.exec(output)?.[1]?.trim()
  const userScope = agent !== 'claude' || /^\s*Scope:\s*User config\b/im.test(output)
  return command === commandPath && args === 'mcp' && userScope
}

function execute(command: string, args: string[]): Promise<Result> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        code: error ? typeof error.code === 'number' ? error.code : 127 : 0,
        stdout,
        stderr: error && !stderr ? error.message : stderr
      })
    })
  })
}

export async function installAgent(kind: Agent | 'all', options: Options = {}): Promise<void> {
  const home = options.home ?? homedir()
  const source = options.skillSource ?? join(
    process.env.JAVIS_APP_PATH ?? join(home, 'Applications', 'Javis.app'),
    'Contents', 'Resources', 'skills', 'javis', 'SKILL.md'
  )
  const commandPath = options.commandPath ?? join(home, '.local', 'bin', 'javis')
  const run = options.run ?? execute
  const agents: Agent[] = kind === 'all' ? ['codex', 'claude'] : [kind]
  if (agents.some((agent) => agent !== 'codex' && agent !== 'claude')) {
    throw new Error('Agent must be codex, claude, or all')
  }
  const skill = await readFile(source, 'utf8')
  const targets = agents.map((agent) => ({
    agent,
    target: join(home, agent === 'codex' ? '.agents' : '.claude', 'skills', 'javis', 'SKILL.md')
  }))
  for (const { target } of targets) {
    let existing: string | undefined
    try { existing = await readFile(target, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (existing !== undefined && existing !== skill) {
      throw new Error(`An existing Javis skill at ${target} has edits; refusing to replace it`)
    }
  }
  for (const { agent } of targets) {
    const existing = await run(agent, ['mcp', 'get', 'javis'])
    if (existing.code === 0) {
      if (!registeredJavisCommand(agent, existing.stdout + existing.stderr, commandPath)) {
        throw new Error(`${agent} has an existing javis MCP server that is not this Javis command`)
      }
      continue
    }
    if (existing.code === 127) throw new Error(`${agent} command is unavailable: ${existing.stderr}`)
    const args = agent === 'codex'
      ? ['mcp', 'add', 'javis', '--', commandPath, 'mcp']
      : ['mcp', 'add', '-s', 'user', 'javis', '--', commandPath, 'mcp']
    const added = await run(agent, args)
    if (added.code !== 0) throw new Error(`${agent} MCP registration failed: ${added.stderr || added.stdout}`)
  }
  for (const { target } of targets) {
    await mkdir(join(target, '..'), { recursive: true, mode: 0o700 })
    await copyFile(source, target)
  }
}
