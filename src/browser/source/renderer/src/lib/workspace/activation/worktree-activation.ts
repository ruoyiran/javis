import { useAppStore } from '@/store'
import { folderWorkspaceKey, worktreeWorkspaceKey } from '../../../../../shared/workspace-scope'
import type { WorkspaceActivationOutcome, FolderWorkspaceActivationOptions, WorkspaceRevealOptions } from './worktree-activation-outcome'
import type { WorktreeActivationOptions } from './worktree-activation-surface-selection'

export function activateAndRevealWorkspaceWithOutcome(context: string, options?: WorkspaceRevealOptions): WorkspaceActivationOutcome {
  const state = useAppStore.getState()
  if (!state.browserTabsByWorktree[context] && state.activeWorktreeId !== context) return { refused: { reason: 'workspace-missing', failureNotified: false } }
  useAppStore.setState({ activeWorktreeId: context, activeWorkspaceKey: worktreeWorkspaceKey(context), activeWorkspaceExecutionHostId: options?.executionHostId ?? null, activeView: 'terminal' })
  state.recordWorktreeVisit(context)
  return { opened: { primaryTabId: state.getActiveTab(context)?.id ?? null } }
}
export function activateAndRevealWorktreeWithOutcome(context: string, options?: WorktreeActivationOptions): WorkspaceActivationOutcome { return activateAndRevealWorkspaceWithOutcome(context, options) }
export function activateAndRevealFolderWorkspaceWithOutcome(id: string, options?: FolderWorkspaceActivationOptions): WorkspaceActivationOutcome { return activateAndRevealWorkspaceWithOutcome(folderWorkspaceKey(id), options) }
export function activateAndRevealWorkspace(context: string, options?: WorkspaceRevealOptions) { const result = activateAndRevealWorkspaceWithOutcome(context, options); return 'opened' in result ? result.opened : false }
export function activateAndRevealWorktree(context: string, options?: WorktreeActivationOptions) { const result = activateAndRevealWorktreeWithOutcome(context, options); return 'opened' in result ? result.opened : false }
export function activateAndRevealFolderWorkspace(id: string, options?: FolderWorkspaceActivationOptions) { const result = activateAndRevealFolderWorkspaceWithOutcome(id, options); return 'opened' in result ? result.opened : false }
