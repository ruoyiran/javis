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

export const useAppStore = create<AppState>()((set, get, api) => ({
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
  runtimeEnvironmentCatalogHydrated: false, sshTargetLabels: {}, sshConnectionStates: {},
  tabBarOrderByWorktree: {}, tabsByWorktree: {}, activeTabIdByWorktree: {}, activeTabTypeByWorktree: {},
  activeFileIdByWorktree: {}, openFiles: [], editorBuffers: {},
  agentConversations: {}, agentStatuses: {}, paneForegroundAgents: {},
  terminalShellOverrides: {}, worktreeNavHistory: [], worktreeNavHistoryIndex: -1,
  activeWorktreeId: null, activeRepoId: null,
  getKnownWorktreeById: (id: string) => get().allWorktrees().find((workspace) => workspace.id === id) ?? null,
  allWorktrees: () => Object.values(get().worktreesByRepo).flat(),
  selectWorktree: (id: string) => set({ activeWorktreeId: id, activeView: 'terminal' }),
  updateSettings: async (updates: Partial<GlobalSettings>) => {
    const settings = await window.api.settings.set(updates)
    set({ settings })
  },
  updateSettingsOrThrow: async (updates: Partial<GlobalSettings>, acknowledged?: (settings: GlobalSettings) => void) => {
    const settings = await window.api.settings.set(updates)
    set({ settings }); acknowledged?.(settings)
  },
  fetchSettings: async () => set({ settings: await window.api.settings.get() }),
} as unknown as AppState))

registerHttpLinkStoreAccessor(useAppStore.getState, useAppStore.subscribe)
registerAppHttpLinkStateAccessor(useAppStore.getState)
registerWorkspaceHttpLinkBrowserOpener(async (request) => {
  const state = useAppStore.getState()
  const context = request.workspaceId ?? state.activeWorktreeId
  if (!context) throw new Error('A browser context is required')
  return state.createBrowserTab(context, request.url).activePageId
})
