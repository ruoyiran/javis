import { FLOATING_TERMINAL_WORKTREE_ID } from '../source/shared/workspace/identity/floating-workspace-id'
import type { BrowserPage } from '../source/shared/browser-workspace-types'
import type { BrowserPageAnnotation } from '../source/shared/browser/element-grab/browser-grab-types'

export function annotationDeliveryContexts(
  pages: Record<string, BrowserPage[]>,
  notes: Record<string, BrowserPageAnnotation[]>,
  active: string | null
): string[] {
  return [
    ...new Set([
      ...(active ? [active] : []),
      FLOATING_TERMINAL_WORKTREE_ID,
      ...Object.values(pages)
        .flat()
        .filter((page) => notes[page.id]?.length)
        .map((page) => page.worktreeId)
    ])
  ]
}
