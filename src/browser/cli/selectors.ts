import { getOptionalStringFlag } from './flags.js'
import type { RuntimeClient } from './runtime-client.js'
export function getExplicitBrowserContext(flags: Map<string, string | boolean>): string | undefined {
  const namespace = getOptionalStringFlag(flags, 'context') ?? getOptionalStringFlag(flags, 'session')
  const worktree = getOptionalStringFlag(flags, 'worktree')
  return namespace ?? (worktree === 'all' ? undefined : worktree)
}
export async function getBrowserWorktreeSelector(flags: Map<string, string | boolean>, cwd: string, _client: RuntimeClient): Promise<string | undefined> {
  const context = getExplicitBrowserContext(flags)
  return context ?? (flags.get('worktree') === 'all' ? undefined : `cwd:${cwd}`)
}
