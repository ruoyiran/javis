import { getOptionalStringFlag } from './flags.js'
import type { RuntimeClient } from './runtime-client.js'
export async function getBrowserWorktreeSelector(flags: Map<string, string | boolean>, cwd: string, _client: RuntimeClient): Promise<string> {
  return getOptionalStringFlag(flags, 'context') ?? getOptionalStringFlag(flags, 'session') ?? getOptionalStringFlag(flags, 'worktree') ?? `cwd:${cwd}`
}
