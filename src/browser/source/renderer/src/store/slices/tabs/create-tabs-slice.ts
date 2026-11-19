import type { StateCreator } from 'zustand'
import type { AppState } from '../../types'
import type { TabsSlice } from './tabs-slice-contract'
import { createTabsFocusActions } from './tabs-focus-actions'
import { createTabsGroupActions, splitGroupEntries, emptySplitGroup } from './tabs-group-actions'
import { createTabsMoveActions } from './tabs-move-actions'
import { createTabsDropActions } from './tabs-drop-actions'
import { createTabsSplitRatioActions } from './tabs-split-ratio-actions'
import { createTabsDragPreviewActions } from './tabs-drag-preview-actions'
import { ensureWorktreeGroup, findTabAndWorktree } from './tab-group-state'
import { buildActiveSurfacePatch } from './tabs-surface'
import { collapseWorktreeGroupLayout } from '../../../../../shared/workspace-layout/tab-group-layout-tree'
import { applyTabOrderSortValues } from '../../../../../shared/workspace-layout/tab-order'
import type { Tab } from '../../../../../shared/tab-types'

export const createTabsSlice: StateCreator<AppState, [], [], TabsSlice> = (set, get, api) => ({
  unifiedTabsByWorktree: {}, groupsByWorktree: {}, activeGroupIdByWorktree: {}, splitLandingGroupIds: {}, layoutByWorktree: {},
  ...createTabsFocusActions(set, get), ...createTabsGroupActions(set, get), ...createTabsMoveActions(set, get), ...createTabsDropActions(set, get), ...createTabsSplitRatioActions(set), ...createTabsDragPreviewActions(set),
  createUnifiedTab: (context, contentType, options) => {
    if (contentType !== 'browser') throw new Error('Javis browser workspaces accept browser and document pages')
    options?.validatePlacement?.(get())
    const id = options?.id ?? crypto.randomUUID()
    let created!: Tab
    set((state) => {
      const split = options?.split ? splitGroupEntries(state, context, options.split, emptySplitGroup(context, crypto.randomUUID())) : null
      const ensured = ensureWorktreeGroup(split?.groups ?? state.groupsByWorktree[context], context, split?.activeGroupId ?? options?.targetGroupId ?? state.activeGroupIdByWorktree[context])
      const group = ensured.group
      const existing = state.unifiedTabsByWorktree[context] ?? []
      const order = group.tabOrder.slice()
      const afterIndex = options?.afterTabId ? order.indexOf(options.afterTabId) : -1
      order.splice(afterIndex >= 0 ? afterIndex + 1 : order.length, 0, id)
      created = { id, entityId: options?.entityId ?? id, groupId: group.id, worktreeId: context, contentType, label: options?.label ?? 'New Tab', customLabel: null, color: null, sortOrder: order.indexOf(id), createdAt: Date.now(), isPinned: options?.isPinned, executionHostId: options?.executionHostId }
      const activate = options?.activate !== false
      const groups = (split?.groups ?? state.groupsByWorktree[context] ?? []).filter((item) => item.id !== group.id)
      groups.push({ ...group, tabOrder: order, activeTabId: activate ? id : group.activeTabId, recentTabIds: activate ? [...(group.recentTabIds ?? []), id] : group.recentTabIds })
      const next = { unifiedTabsByWorktree: { ...state.unifiedTabsByWorktree, [context]: applyTabOrderSortValues([...existing, created], order) }, groupsByWorktree: { ...state.groupsByWorktree, [context]: groups }, layoutByWorktree: { ...state.layoutByWorktree, [context]: split?.layout ?? state.layoutByWorktree[context] ?? { type: 'leaf' as const, groupId: group.id } }, activeGroupIdByWorktree: { ...state.activeGroupIdByWorktree, [context]: activate ? group.id : state.activeGroupIdByWorktree[context] ?? group.id } }
      return { ...next, ...(activate ? buildActiveSurfacePatch({ ...state, ...next }, context, group.id) : {}) }
    })
    return created
  },
  createUnifiedTabInSplit: (context, contentType, target, options) => get().createUnifiedTab(context, contentType, { ...options, split: target }),
  closeUnifiedTab: (id) => {
    const found = findTabAndWorktree(get().unifiedTabsByWorktree, id)
    if (!found) return null
    const { tab, worktreeId: context } = found
    set((state) => {
      const tabs = (state.unifiedTabsByWorktree[context] ?? []).filter((item) => item.id !== id)
      const groups = (state.groupsByWorktree[context] ?? []).map((group) => {
        const order = group.tabOrder.filter((item) => item !== id)
        const recent = group.recentTabIds?.filter((item) => item !== id)
        return { ...group, tabOrder: order, recentTabIds: recent, activeTabId: group.activeTabId === id ? recent?.at(-1) ?? order.at(-1) ?? null : group.activeTabId }
      })
      const next = { unifiedTabsByWorktree: { ...state.unifiedTabsByWorktree, [context]: tabs }, groupsByWorktree: { ...state.groupsByWorktree, [context]: groups } }
      return { ...next, ...buildActiveSurfacePatch({ ...state, ...next }, context, state.activeGroupIdByWorktree[context]) }
    })
    return { closedTabId: tab.id, wasLastTab: !(get().unifiedTabsByWorktree[context]?.length), worktreeId: context }
  },
  closeUnifiedTabs: (ids) => { for (const id of ids) get().closeUnifiedTab(id) },
  setTabLabel: (id, label) => set((state) => ({ unifiedTabsByWorktree: Object.fromEntries(Object.entries(state.unifiedTabsByWorktree).map(([context, tabs]) => [context, tabs.map((tab) => tab.id === id ? { ...tab, label } : tab)])) })),
  setTabCustomLabel: (id, customLabel) => set((state) => ({ unifiedTabsByWorktree: Object.fromEntries(Object.entries(state.unifiedTabsByWorktree).map(([context, tabs]) => [context, tabs.map((tab) => tab.id === id ? { ...tab, customLabel } : tab)])) })),
  pinTab: (id) => { const tab = get().getTab(id); if (tab) set((state) => ({ unifiedTabsByWorktree: { ...state.unifiedTabsByWorktree, [tab.worktreeId]: (state.unifiedTabsByWorktree[tab.worktreeId] ?? []).map((item) => item.id === id ? { ...item, isPinned: true } : item) } })) },
  unpinTab: (id) => { const tab = get().getTab(id); if (tab) set((state) => ({ unifiedTabsByWorktree: { ...state.unifiedTabsByWorktree, [tab.worktreeId]: (state.unifiedTabsByWorktree[tab.worktreeId] ?? []).map((item) => item.id === id ? { ...item, isPinned: false } : item) } })) },
  reorderUnifiedTabs: (groupId, ids) => {
    const context = Object.entries(get().groupsByWorktree).find(([, groups]) => groups.some((group) => group.id === groupId))?.[0]
    if (!context) return
    set((state) => ({ unifiedTabsByWorktree: { ...state.unifiedTabsByWorktree, [context]: applyTabOrderSortValues(state.unifiedTabsByWorktree[context] ?? [], ids) }, groupsByWorktree: { ...state.groupsByWorktree, [context]: (state.groupsByWorktree[context] ?? []).map((group) => group.id === groupId ? { ...group, tabOrder: ids } : group) } }))
  }
} as TabsSlice)
