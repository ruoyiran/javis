import { buildEditorSessionData } from '../source/renderer/src/lib/workspace/persistence/workspace-session-editor-files'
import { buildBrowserSessionData } from '../source/renderer/src/lib/workspace/persistence/workspace-session-browser-tabs'
import { withoutStagedBrowserTabs } from '../source/renderer/src/lib/workspace/persistence/workspace-session-staged-browser-tabs'
import { buildHydratedEditorSessionState } from '../source/renderer/src/store/slices/editor/hydration/hydrated-editor-session-state'
import { migrateHydratedEditorTabsAndGroups } from '../source/renderer/src/store/slices/editor/file-ids/hydrated-editor-file-ids'
import type { AppState } from '../source/renderer/src/store/types'
import type { WorkspaceSessionState } from '../source/shared/workspace-session/workspace-session-state-types'
import { loadWorkspaceLayoutWithoutReport } from '../source/shared/workspace-layout/workspace-layout-load'
import { saveWorkspaceLayout } from '../source/shared/workspace-layout/workspace-layout-save'
import { buildHydratedTabState } from '../source/renderer/src/store/slices/tabs/tabs-hydration'
import { projectHydratedBrowserSession } from '../source/renderer/src/store/slices/browser/hydration/browser-hydration-state'
import { buildActiveSurfacePatch } from '../source/renderer/src/store/slices/tabs/tabs-surface'
import { getDefaultWorkspaceSession } from '../source/shared/constants'

function normalized(session: WorkspaceSessionState): WorkspaceSessionState {
  return saveWorkspaceLayout(loadWorkspaceLayoutWithoutReport('local', session, { mintId: (seed) => `javis:${seed}`, mintLeafId: (seed) => `javis:${seed}` }))
}
export function hydrateWorkspaceSession(state: AppState, input: WorkspaceSessionState, context: string, validContexts: ReadonlySet<string>): Partial<AppState> {
  const session = normalized(input)
  const editor = buildHydratedEditorSessionState(session, validContexts, context)
  const files = Object.entries(session.openFilesByWorktree ?? {}).flatMap(([id, entries]) => validContexts.has(id) ? entries.map((file) => ({ ...file, id: file.filePath, mode: 'edit' as const, isDirty: file.dirtyDraftContent !== undefined })) : [])
  const base = { ...state, activeWorktreeId: context, activeTabTypeByWorktree: session.activeTabTypeByWorktree ?? {}, activeTabType: session.activeTabTypeByWorktree?.[context] ?? 'browser', openFiles: files, tabsByWorktree: session.tabsByWorktree ?? {} } as AppState
  const browser = projectHydratedBrowserSession(base, session, validContexts)
  const tabs = buildHydratedTabState(session, new Set(validContexts))
  const migrated = migrateHydratedEditorTabsAndGroups({ ...state, ...tabs }, editor.editorFileIdMigrationsByWorktree)
  const membership = { ...tabs, ...migrated }
  const groupsByWorktree = Object.fromEntries(Object.entries(membership.groupsByWorktree).map(([id,groups])=>{
    const available = (membership.unifiedTabsByWorktree[id]??[]).filter((tab)=>tab.contentType==='browser' ? browser.browserTabsByWorktree[id]?.some((workspace)=>workspace.id===tab.entityId) : tab.contentType==='editor' && editor.state.openFiles.some((file)=>file.id===tab.entityId))
    return [id,groups.map((group)=>{
      if(available.some((tab)=>tab.id===group.activeTabId && tab.groupId===group.id))return group
      const candidates=group.tabOrder.map((tabId)=>available.find((tab)=>tab.id===tabId && tab.groupId===group.id)).filter((tab)=>tab!==undefined)
      const remembered=candidates.find((tab)=>tab.entityId===browser.activeBrowserTabIdByWorktree[id])
      return {...group,activeTabId:remembered?.id??candidates.find((tab)=>tab.id===group.recentTabIds?.at(-1))?.id??candidates[0]?.id??null}
    })]
  }))
  const next = { ...base, ...browser, ...tabs, ...editor.state, ...migrated, groupsByWorktree, activeFileIdByWorktree: session.activeFileIdByWorktree ?? {}, activeTabIdByWorktree: session.activeTabIdByWorktree ?? {} }
  return { ...browser, ...tabs, ...editor.state, ...migrated, groupsByWorktree, ...buildActiveSurfacePatch(next, context, tabs.activeGroupIdByWorktree[context]) }
}
export function serializeWorkspaceSession(state: AppState, carried: WorkspaceSessionState = getDefaultWorkspaceSession()): WorkspaceSessionState {
  const snapshot = withoutStagedBrowserTabs(state)
  const browserData = buildBrowserSessionData(snapshot.browserTabsByWorktree,snapshot.browserPagesByWorkspace,snapshot.activeBrowserTabIdByWorktree,state.remoteBrowserPageHandlesByPageId,state.browserAnnotationsByPageId)
  const editorData = buildEditorSessionData(state.openFiles,state.editorDrafts,state.markdownFrontmatterVisible,state.activeFileIdByWorktree,state.activeTabTypeByWorktree)
  return normalized({ ...carried, activeWorktreeId: state.activeWorktreeId, activeWorkspaceKey: state.activeWorkspaceKey, activeWorkspaceExecutionHostId: state.activeWorkspaceExecutionHostId, activeTabId: state.activeTabId, unifiedTabs: snapshot.unifiedTabsByWorktree, tabGroups: state.groupsByWorktree, tabGroupLayouts: state.layoutByWorktree, activeGroupIdByWorktree: state.activeGroupIdByWorktree, ...browserData, activeTabTypeByWorktree: state.activeTabTypeByWorktree, ...editorData, browserUrlHistory: state.browserUrlHistory, workspaceDocHistory: state.workspaceDocHistory, clientHostedBrowserCloseIntentsByEnvironment: state.clientHostedBrowserCloseIntentsByEnvironment })
}
