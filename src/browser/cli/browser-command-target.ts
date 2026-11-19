import { getOptionalStringFlag, getPresentStringFlag } from './flags.js'
import { getBrowserWorktreeSelector } from './selectors.js'
import type { RuntimeClient } from './runtime-client.js'
export async function getBrowserCommandTarget(flags: Map<string, string | boolean>, cwd: string, client: RuntimeClient): Promise<{ page?: string; worktree?: string; expectUrl?: string }> {
  const expectUrl = getPresentStringFlag(flags, 'expect-url')
  const page = getOptionalStringFlag(flags, 'page')
  const explicit = getOptionalStringFlag(flags, 'context') ?? getOptionalStringFlag(flags, 'session') ?? getOptionalStringFlag(flags, 'worktree')
  const target = page
    ? { page, ...(explicit && explicit !== 'all' ? { worktree: explicit } : {}) }
    : { worktree: await getBrowserWorktreeSelector(flags, cwd, client) }
  return { ...target, ...(expectUrl === undefined ? {} : { expectUrl }) }
}
