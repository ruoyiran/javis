import { useAppStore } from '@/store'
import type { KeybindingContext } from '../../../../../shared/keybindings/types'
import { resolveBrowserWorkspaceOwner } from '../../browser/workspace/browser-workspace-source-resolution'
import { guardPinnedTabClose, resolvePinnedTabLabel } from '@/store/slices/tabs/closing/pinned-tab-close-guard'
import { hasUnsentBrowserNotes } from '@/store/slices/browser/annotations/browser-page-annotation'
export type WorkspaceTabTarget =
  | { kind: 'tab'; worktreeId: string; tabId: string }
  | { kind: 'browser-source'; sourceId: string }

export type WorkspaceTabCommand =
  | {
      type: 'close'
      target?: WorkspaceTabTarget
      context?: KeybindingContext
      skipEmptyCheck?: boolean
      bulk?: boolean
      floatingPanelGuestOwned?: boolean
    }
  | {
      type: 'switch'
      direction: number
      scope: 'same-type' | 'all-types' | 'terminal'
      floatingPanelOwned?: boolean
    }
  | { type: 'previous-recent'; floatingPanelOwned?: boolean }


export function dispatchWorkspaceTabCommand(command: WorkspaceTabCommand, contextOverride?: string): boolean {
  const state = useAppStore.getState()
  const context = contextOverride ?? (command.type === 'close' && command.target?.kind === 'tab' ? command.target.worktreeId : state.activeWorktreeId)
  if (!context) return false
  const groupId = state.activeGroupIdByWorktree[context]
  const group = state.groupsByWorktree[context]?.find((item) => item.id === groupId)
  const tabs = (state.unifiedTabsByWorktree[context] ?? []).filter((tab) => (tab.contentType === 'browser' || tab.contentType === 'editor') && tab.groupId === groupId)
  if (command.type !== 'close') {
    const current = tabs.findIndex((tab) => tab.id === group?.activeTabId)
    const recent = group?.recentTabIds?.filter((id) => id !== group.activeTabId).at(-1)
    const next = command.type === 'previous-recent' ? tabs.find((tab) => tab.id === recent) : tabs[(current + command.direction + tabs.length) % tabs.length]
    if (!next) return false
    state.activateTab(next.id); state.setActiveBrowserTab(next.entityId); return true
  }
  const owner = command.target?.kind === 'browser-source' ? resolveBrowserWorkspaceOwner(state, command.target.sourceId) : null
  const tab = command.target?.kind === 'tab' ? state.getTab(command.target.tabId) : owner ? (state.unifiedTabsByWorktree[owner.worktreeId] ?? []).find((item) => item.entityId === owner.workspaceId) : state.getActiveTab(context)
  if (!tab) return false
  if (tab.contentType === 'editor') { window.dispatchEvent(new CustomEvent('javis-close-source', {detail:{tabId:tab.id}})); return true }
  if (tab.contentType !== 'browser') return false
  const unsentNotes = hasUnsentBrowserNotes(state, tab.entityId)
  if (command.bulk && (tab.isPinned || unsentNotes)) return true
  guardPinnedTabClose({ isPinned: tab.isPinned === true, tabLabel: resolvePinnedTabLabel(state, tab.worktreeId, tab.id), unsentNotes, onClose: () => state.closeBrowserTab(tab.entityId) })
  return true
}
