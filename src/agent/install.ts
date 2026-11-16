import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

type Agent = 'codex' | 'claude'
type Result = { code: number; stdout: string; stderr: string }
type Options = {
  home?: string
  skillSource?: string
  commandPath?: string
  run?: (command: string, args: string[]) => Promise<Result>
}

const legacyManagedSkillHashes = new Set([
  'a6236d24225ee320fee6c121f30b686e7c9f8ac509c1259868cc08074cf8d809'
])

function digest(text: string): string { return createHash('sha256').update(text).digest('hex') }

async function assertSafeManifest(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.()) {
      throw new Error(`Javis manifest at ${path} is a symlink or unsafe file`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function managedDigest(path: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (parsed && typeof parsed === 'object' && 'sha256' in parsed && typeof parsed.sha256 === 'string') {
      return parsed.sha256
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return undefined
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
    const manifest = join(dirname(target), '.javis-managed.json')
    await assertSafeManifest(manifest)
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error(`An existing Javis skill at ${target} is a symlink; refusing to replace it`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try { existing = await readFile(target, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (existing !== undefined && existing !== skill) {
      const installedHash = digest(existing)
      const recordedHash = await managedDigest(manifest)
      if (installedHash !== recordedHash && !legacyManagedSkillHashes.has(installedHash)) {
        throw new Error(`An existing Javis skill at ${target} has edits; refusing to replace it`)
      }
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
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await copyFile(source, target)
    const manifest = join(dirname(target), '.javis-managed.json')
    const temporary = join(dirname(target), `.javis-managed-${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, JSON.stringify({ sha256: digest(skill) }), { flag: 'wx', mode: 0o600 })
      await rename(temporary, manifest)
    } finally {
      await rm(temporary, { force: true })
    }
  }
}
