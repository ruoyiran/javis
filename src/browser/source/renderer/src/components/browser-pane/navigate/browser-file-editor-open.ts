import { getConnectionIdFromState } from '@/lib/workspace/ownership/connection-owner-resolution'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/files/access/file-owner-runtime-target'
import { getRelativePathInsideRoot } from '@/lib/path'
import { javisContextHost } from '@/store/workspaces/javis-context-catalog'
import { toast } from 'sonner'
import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { openDocPreviewSource } from '../workspace-doc/doc-preview-document-actions'

/** file:// names this computer’s disk; a remote workspace editor would read the same path on another host. */
export function canOpenBrowserFileInWorkspaceEditor(state: AppState, worktreeId: string): boolean {
  return (
    getConnectionIdFromState(state, worktreeId) === null &&
    getRuntimeTargetForWorktreeOwner(state, worktreeId)?.kind === 'local'
  )
}

export async function openBrowserFileSource(worktreeId: string, filePath: string): Promise<void> {
  const state = useAppStore.getState()
  if (!canOpenBrowserFileInWorkspaceEditor(state, worktreeId)) {
    return
  }
  const worktreeRoot = state.getKnownWorktreeById(worktreeId)?.path ?? null
  try {
    const relativePath = getRelativePathInsideRoot(filePath,worktreeRoot)
    if (relativePath===null || !javisContextHost(worktreeId)) throw new Error('The source path is outside this context')
    const api=(window.api as unknown as {javisBrowser:{call(method:string,params:Record<string,unknown>):Promise<unknown>}}).javisBrowser
    const stat = await api.call('browser.host.call',{target:'local',method:'files.stat',params:{worktree:worktreeId,relativePath}}) as {isDirectory:boolean;escapesWorktree?:boolean}
    if (
      stat.isDirectory ||
      !canOpenBrowserFileInWorkspaceEditor(useAppStore.getState(), worktreeId)
    ) {
      return
    }
    openDocPreviewSource({
      filePath,
      relativePath: stat.escapesWorktree
        ? filePath
        : (getRelativePathInsideRoot(filePath, worktreeRoot) ?? filePath),
      worktreeId,
      runtimeEnvironmentId: null,
      externalSshTargetId: null
    })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}
