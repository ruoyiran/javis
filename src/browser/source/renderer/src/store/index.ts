import { EDITOR_FOCUS_REQUEST_TTL_MS } from './slices/editor/types/pending-editor-reveal'
import { takeNextEditorFocusRequestToken } from './slices/editor/focus/editor-focus-reveal'
import type { OpenFileOptions } from './slices/editor/types/editor-files-slice'
import { withEditorBufferRecords } from './slices/editor/buffers/editor-buffer-record-lifecycle'
import { javisContext, javisContextHost } from './workspaces/javis-context-catalog'
import { resolveEditorFileIdForOwner } from './slices/editor/file-ids/editor-file-ids'
import type { OpenFile } from './slices/editor/types/open-file'
import { getRelativePathInsideRoot } from '../lib/path'
import { createEditorSlice } from './slices/editor/create-editor-slice'
import { javisContextWorkspace, useJavisContexts } from './workspaces/javis-context-catalog'
import { create } from 'zustand'
import type { AppState } from './types'
import { createBrowserSlice } from './slices/browser/create-browser-slice'
import { createPinnedTabCloseConfirmSlice } from './slices/tabs/pinned-tab-close-confirm'
import { createTabsSlice } from './slices/tabs/create-tabs-slice'
import { createUISlice } from './slices/ui/create-ui-slice'
import { createKeybindingsSlice } from './slices/keybindings/keybindings'
import { createRecentlyClosedTabsSlice } from './slices/tabs/recently-closed-tabs'
import { createWorktreeNavHistorySlice } from './slices/ui/workspace-navigation-history'
import { createSettingsSearchState } from './slices/settings/settings-search-state'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { registerHttpLinkStoreAccessor, registerWorkspaceHttpLinkBrowserOpener } from '../lib/browser/navigation/http-link-routing'
import { registerAppHttpLinkStateAccessor } from '../lib/browser/navigation/app-http-link-open'

export const useAppStore = create<AppState>()(withEditorBufferRecords((set, get, api) => ({
  ...createEditorSlice(set, get, api),
  ...createBrowserSlice(set, get, api),
  ...createTabsSlice(set, get, api),
  ...createPinnedTabCloseConfirmSlice(set, get, api),
  ...createUISlice(set, get, api),
  ...createKeybindingsSlice(set, get, api),
  ...createWorktreeNavHistorySlice(set, get, api),
  ...createRecentlyClosedTabsSlice(set, get, api),
  ...createSettingsSearchState((state) => set(state)),
  settings: null,
  repos: [], worktreesByRepo: {}, detectedWorktreesByRepo: {}, folderWorkspaces: [],
  projectGroups: [], projects: [], runtimeEnvironments: [], runtimeStatusByEnvironmentId: new Map(),
  runtimeEnvironmentCatalogHydrated: false, sshTargetLabels: new Map(), sshConnectionStates: new Map(),
  tabBarOrderByWorktree: {}, tabsByWorktree: {}, activeTabIdByWorktree: {}, activeTabTypeByWorktree: {},
  activeFileIdByWorktree: {}, openFiles: [], editorBuffers: {},
  agentConversations: {}, agentStatuses: {}, paneForegroundAgents: {},
  terminalShellOverrides: {}, worktreeNavHistory: [], worktreeNavHistoryIndex: -1,
  activeWorktreeId: null, activeRepoId: null,
  getKnownWorktreeById: (id: string, host?: import('../../../shared/execution-host').ExecutionHostId) => javisContext(id) ? javisContextWorkspace(id,host) : get().allWorktrees().find((workspace) => workspace.id === id),
  allWorktrees: () => [...Object.values(get().worktreesByRepo).flat(), ...Object.keys(useJavisContexts.getState().contexts).flatMap((id) => { const row = javisContextWorkspace(id); return row ? [row] : [] })],
  selectWorktree: (id: string) => set({ activeWorktreeId: id, activeView: 'terminal' }),
  updateSettings: async (updates: Partial<GlobalSettings>) => {
    const settings = await window.api.settings.set(updates)
    set({ settings })
  },
  updateSettingsOrThrow: async (updates: Partial<GlobalSettings>, acknowledged?: (settings: GlobalSettings) => void) => {
    const settings = await window.api.settings.set(updates)
    set({ settings }); acknowledged?.(settings)
  },
  setActiveWorktree: (id: string) => { set({ activeWorktreeId: id }); return true },
  openFile: (request: Omit<OpenFile, 'id' | 'isDirty'>, options?:OpenFileOptions) => {
    const context = javisContext(request.worktreeId), host = javisContextHost(request.worktreeId)
    if (!context?.root || !host || getRelativePathInsideRoot(request.filePath,context.root)===null) throw new Error('The source file has no available context authority')
    const runtimeEnvironmentId = context.owner.kind === 'runtime' ? context.owner.environmentId : null
    const id=resolveEditorFileIdForOwner(get(),request.filePath,request.worktreeId,runtimeEnvironmentId,['edit'])
    if (!get().openFiles.some((file)=>file.id===id)) set((state)=>({openFiles:[...state.openFiles,{...request,id,isDirty:false,runtimeEnvironmentId,...(context.owner.kind==='ssh'?{externalSshTargetId:context.owner.connectionId}:{})}]}))
    const placement=options?.placementWorkspaceId??request.worktreeId
    const tab=(get().unifiedTabsByWorktree[placement]??[]).find((tab)=>tab.contentType==='editor' && tab.entityId===id && (!options?.targetGroupId || tab.groupId===options.targetGroupId))
    const shown=tab??get().createUnifiedTab(placement,'editor',{entityId:id,label:request.relativePath,executionHostId:host,targetGroupId:options?.targetGroupId})
    if(tab)get().activateTab(tab.id)
    set({pendingEditorFocusRequest:{fileId:id,worktreeId:placement,viewStateId:shown.id,expiresAt:Date.now()+EDITOR_FOCUS_REQUEST_TTL_MS,token:takeNextEditorFocusRequestToken()}})
  },
  fetchSettings: async () => set({ settings: await window.api.settings.get() }),
} as unknown as AppState), false))

registerHttpLinkStoreAccessor(useAppStore.getState, useAppStore.subscribe)
registerAppHttpLinkStateAccessor(useAppStore.getState)
registerWorkspaceHttpLinkBrowserOpener(async (request) => {
  const state = useAppStore.getState()
  const context = request.workspaceId ?? state.activeWorktreeId
  if (!context) throw new Error('A browser context is required')
  return state.createBrowserTab(context, request.url).activePageId
})
