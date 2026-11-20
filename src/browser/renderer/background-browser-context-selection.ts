import { FLOATING_TERMINAL_WORKTREE_ID } from '../source/shared/workspace/identity/floating-workspace-id'
import type { BrowserPage } from '../source/shared/browser-workspace-types'

export function backgroundBrowserContexts(
  pages: Record<string, BrowserPage[]>,
  requested: ReadonlySet<string>,
  active: string | null,
  needsPaint: (id: string) => boolean
): string[] {
  const available = new Set(
    Object.values(pages)
      .flat()
      .map((page) => page.worktreeId)
  )
  const painted = new Set(
    Object.values(pages)
      .flat()
      .filter((page) => needsPaint(page.id))
      .map((page) => page.worktreeId)
  )
  return [...new Set([...requested, ...painted])].filter(
    (id) => id !== active && id !== FLOATING_TERMINAL_WORKTREE_ID && available.has(id)
  )
}
