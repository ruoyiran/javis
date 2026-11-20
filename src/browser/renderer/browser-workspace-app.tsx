import { FLOATING_TERMINAL_WORKTREE_ID } from '../source/shared/workspace/identity/floating-workspace-id'
import { BackgroundBrowserContexts } from './background-browser-contexts'
import { closeGuardedTab } from './guarded-tab-close'
import { hasUnsentBrowserNotes } from '../source/renderer/src/store/slices/browser/annotations/browser-page-annotation'

import BrowserPaneOverlayLayer from '../source/renderer/src/components/browser-pane/assemble-chrome/BrowserPaneOverlayLayer'
import { useJavisContexts } from '../source/renderer/src/store/workspaces/javis-context-catalog'
import { useConfirmationDialog } from '../source/renderer/src/components/confirmation-dialog-context'
import { tabGroupBodyAnchorName } from '../source/renderer/src/components/tab-group/tab-group-body-anchor'
import { createContext, useContext, useCallback } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { registerTabGroupBody } from '../source/renderer/src/components/tab-group/tab-group-body-geometry'
import { getTabPaneBodyDroppableId } from '../source/renderer/src/components/tab-group/useTabDragSplit'
import EditorFileTab from '../source/renderer/src/components/tab-bar/EditorFileTab'
import ClientHostedBrowserTabRows from '../source/renderer/src/components/tab-bar/ClientHostedBrowserTabRows'
import {
  useClientHostedBrowserRows,
  useActiveClientHostedBrowserRowId
} from '../source/renderer/src/runtime/browser/client-hosting/client-hosted-browser-row-state'
import { ClientHostedBrowserHostRowPane } from '../source/renderer/src/components/browser-pane/client-hosted-browser-host-row-pane'
import { ContextSourceEditor } from './context-source-editor'
import { FloatingBrowserWorkspace } from './floating-browser-workspace'
import { useRef } from 'react'
import { ResizeHandle } from '../source/renderer/src/components/tab-group/SplitResizeHandle'
import { acquireWebviewsDragPassthrough } from '../source/renderer/src/components/browser-pane/host-guest/webview-drag-passthrough'
import { dispatchWorkspaceTabCommand } from '../source/renderer/src/lib/workspace/tabs/workspace-tab-commands'
import { useState, useEffect } from 'react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, Settings, ArrowLeft } from 'lucide-react'
import { useAppStore } from '../source/renderer/src/store'
import BrowserPane from '../source/renderer/src/components/browser-pane/BrowserPane'
import BrowserTab from '../source/renderer/src/components/tab-bar/BrowserTab'
import { BrowserPane as BrowserSettingsPane } from '../source/renderer/src/components/settings/browser/BrowserPane'
import { Button } from '../source/renderer/src/components/ui/button'
import { Input } from '../source/renderer/src/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '../source/renderer/src/components/ui/tooltip'
import { useTabDragSplit } from '../source/renderer/src/components/tab-group/useTabDragSplit'
import type { TabGroupLayoutNode } from '../source/shared/tab-types'
import { useTranslate } from '../source/renderer/src/i18n/use-translate'

export const BrowserDragContext = createContext<ReturnType<typeof useTabDragSplit> | null>(null)
function BrowserGroup({
  context,
  groupId
}: {
  context: string
  groupId: string
}): React.JSX.Element {
  const state = useAppStore()
  const confirm = useConfirmationDialog()
  const closeTab = async (tabId: string, bulk = false): Promise<void> => {
    const latest = useAppStore.getState(),
      tab = latest.getTab(tabId)
    if (!tab) return
    const file = latest.openFiles.find((file) => file.id === tab.entityId)
    await closeGuardedTab(
      tab,
      {
        pinned: tab.isPinned === true,
        dirty: file?.isDirty === true,
        unsentNotes: tab.contentType === 'browser' && hasUnsentBrowserNotes(latest, tab.entityId)
      },
      bulk,
      {
        confirmPinned: () =>
          latest.settings?.confirmClosePinnedTab === false
            ? Promise.resolve(true)
            : confirm({
                title: 'Close pinned tab?',
                description: tab.label,
                confirmLabel: 'Close',
                confirmVariant: 'destructive'
              }),
        confirmDirty: () =>
          confirm({
            title: 'Discard unsaved changes?',
            description: file?.relativePath,
            confirmLabel: 'Discard',
            confirmVariant: 'destructive'
          }),
        confirmNotes: () =>
          confirm({
            title: 'Discard unsent notes?',
            description: tab.label,
            confirmLabel: 'Discard',
            confirmVariant: 'destructive'
          }),
        retire: (id) => useAppStore.getState().closeUnifiedTab(id)
      }
    )
  }
  useEffect(() => {
    const close = (event: Event) => {
      const { tabId, bulk } = (event as CustomEvent<{ tabId: string; bulk?: boolean }>).detail
      if (useAppStore.getState().getTab(tabId)?.groupId === groupId) void closeTab(tabId, bulk)
    }
    window.addEventListener('javis-close-source', close)
    return () => window.removeEventListener('javis-close-source', close)
  }, [groupId, confirm])
  const drag = useContext(BrowserDragContext)
  const { setNodeRef } = useDroppable({
    id: getTabPaneBodyDroppableId(groupId),
    data: { kind: 'pane-body', groupId, worktreeId: context },
    disabled: !drag?.activeDrag
  })
  const bodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node)
      return node ? registerTabGroupBody(groupId, node) : undefined
    },
    [setNodeRef, groupId]
  )
  const rows = useClientHostedBrowserRows(context)
  const selectedRow = useActiveClientHostedBrowserRowId({
    worktreeId: context,
    groupId,
    groupActiveTabId:
      state.groupsByWorktree[context]?.find((group) => group.id === groupId)?.activeTabId ?? null
  })
  const t = useTranslate()
  const group = state.groupsByWorktree[context]?.find((item) => item.id === groupId)
  const tabs = (state.unifiedTabsByWorktree[context] ?? [])
    .filter((tab) => tab.groupId === groupId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const focused = state.activeGroupIdByWorktree[context] === groupId
  const active = tabs.find((tab) => tab.id === group?.activeTabId) ?? tabs[0]
  const close = (id: string, bulk = false): void => {
    const tab = tabs.find((tab) => tab.entityId === id)
    if (tab) void closeTab(tab.id, bulk)
  }
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onPointerDown={() => state.focusGroup(context, groupId)}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-background">
        <div className="scrollbar-sleek flex min-w-0 flex-1 overflow-x-auto">
          <SortableContext
            items={tabs.map((tab) => tab.entityId)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab, index) => {
              const browser = state.browserTabsByWorktree[context]?.find(
                (item) => item.id === tab.entityId
              )
              if (!browser) {
                const file = state.openFiles.find((file) => file.id === tab.entityId)
                if (!file) return null
                const closeFile = () => {
                  void closeTab(tab.id)
                }
                return (
                  <EditorFileTab
                    key={tab.id}
                    file={{ ...file, tabId: tab.id }}
                    isActive={active?.id === tab.id}
                    isPinned={tab.isPinned === true}
                    hasTabsToLeft={index > 0}
                    hasTabsToRight={index < tabs.length - 1}
                    tabCount={tabs.length}
                    gitStatus={null}
                    onActivate={() => state.activateTab(tab.id)}
                    onClose={closeFile}
                    onCloseOthers={() => state.closeOtherTabs(tab.id)}
                    onCloseToLeft={() => state.closeTabsToLeft(tab.id)}
                    onCloseToRight={() => state.closeTabsToRight(tab.id)}
                    onCloseAll={() => tabs.forEach((entry) => void closeTab(entry.id, true))}
                    onTogglePin={() =>
                      tab.isPinned ? state.unpinTab(tab.id) : state.pinTab(tab.id)
                    }
                    dragData={{
                      kind: 'tab',
                      tabType: 'editor',
                      visibleTabId: tab.id,
                      unifiedTabId: tab.id,
                      groupId,
                      worktreeId: context,
                      label: tab.label
                    }}
                    dropIndicator={
                      drag?.hoveredTabInsertion?.visibleTabId === tab.id
                        ? drag.hoveredTabInsertion.side
                        : undefined
                    }
                  />
                )
              }
              return (
                <BrowserTab
                  key={browser.id}
                  tab={{ ...browser, title: tab.customLabel ?? browser.title }}
                  isActive={active?.id === tab.id}
                  isPinned={tab.isPinned === true}
                  hasTabsToLeft={index > 0}
                  hasTabsToRight={index < tabs.length - 1}
                  tabCount={tabs.length}
                  dragData={{
                    kind: 'tab',
                    tabType: 'browser',
                    visibleTabId: browser.id,
                    unifiedTabId: tab.id,
                    groupId,
                    worktreeId: context,
                    label: tab.label
                  }}
                  dropIndicator={
                    drag?.hoveredTabInsertion?.visibleTabId === browser.id
                      ? drag.hoveredTabInsertion.side
                      : undefined
                  }
                  onActivate={() => {
                    state.activateTab(tab.id)
                    state.setActiveBrowserTab(browser.id)
                  }}
                  onClose={() => close(browser.id)}
                  onCloseOthers={() =>
                    tabs
                      .filter((item) => item.id !== tab.id && !item.isPinned)
                      .forEach((item) => close(item.entityId, true))
                  }
                  onCloseToLeft={() =>
                    tabs
                      .slice(0, index)
                      .filter((item) => !item.isPinned)
                      .forEach((item) => close(item.entityId, true))
                  }
                  onCloseToRight={() =>
                    tabs
                      .slice(index + 1)
                      .filter((item) => !item.isPinned)
                      .forEach((item) => close(item.entityId, true))
                  }
                  onDuplicate={() =>
                    state.createBrowserTab(context, browser.url, {
                      sessionProfileId: browser.sessionProfileId,
                      targetGroupId: groupId
                    })
                  }
                  onTogglePin={() => (tab.isPinned ? state.unpinTab(tab.id) : state.pinTab(tab.id))}
                  onCloseSplitPane={() =>
                    (() => {
                      tabs
                        .filter((item) => !item.isPinned)
                        .forEach((item) => close(item.entityId, true))
                      state.closeEmptyGroup(context, groupId)
                    })()
                  }
                />
              )
            })}
          </SortableContext>
          {state.groupsByWorktree[context]?.[0]?.id === groupId && (
            <ClientHostedBrowserTabRows
              rows={rows}
              worktreeId={context}
              groupId={groupId}
              groupActiveTabId={group?.activeTabId ?? null}
              includeTopTabBorder
            />
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('browser.newTab', 'New Tab')}
              onClick={() => void state.openNewBrowserTabInActiveWorkspace(groupId)}
            >
              <Plus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('browser.newTab', 'New Tab')}</TooltipContent>
        </Tooltip>
      </div>
      <div
        ref={bodyRef}
        data-tab-group-body-id={groupId}
        data-worktree-id={context}
        style={{ anchorName: tabGroupBodyAnchorName(groupId) }}
        className="relative flex min-h-0 flex-1 overflow-hidden"
      >
        {state.openFiles
          .filter((file) =>
            tabs.some((tab) => tab.entityId === file.id && tab.contentType === 'editor')
          )
          .map((file) => (
            <ContextSourceEditor
              key={file.id}
              file={file}
              viewId={tabs.find((tab) => tab.entityId === file.id)?.id}
              active={
                !selectedRow &&
                active?.entityId === file.id &&
                (context === FLOATING_TERMINAL_WORKTREE_ID
                  ? state.floatingWorkspacePanelOpen
                  : state.activeView !== 'settings')
              }
            />
          ))}

        {drag?.hoveredDropTarget?.groupId === groupId && (
          <div
            className="pointer-events-none absolute inset-0 border-2 border-ring bg-accent/30"
            style={
              drag.hoveredDropTarget.zone === 'left'
                ? { right: '50%' }
                : drag.hoveredDropTarget.zone === 'right'
                  ? { left: '50%' }
                  : drag.hoveredDropTarget.zone === 'up'
                    ? { bottom: '50%' }
                    : drag.hoveredDropTarget.zone === 'down'
                      ? { top: '50%' }
                      : {}
            }
          />
        )}
      </div>
    </section>
  )
}
export function BrowserLayout({
  context,
  node,
  path = ''
}: {
  context: string
  node: TabGroupLayoutNode
  path?: string
}): React.JSX.Element {
  const release = useRef<(() => void) | null>(null)
  useEffect(() => () => release.current?.(), [])
  if (node.type === 'leaf') return <BrowserGroup context={context} groupId={node.groupId} />
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 ${node.direction === 'horizontal' ? 'flex-row' : 'flex-col'}`}
    >
      <div className="flex min-h-0 min-w-0" style={{ flex: node.ratio ?? 0.5 }}>
        <BrowserLayout
          context={context}
          node={node.first}
          path={path ? `${path}.first` : 'first'}
        />
      </div>
      <ResizeHandle
        direction={node.direction}
        onResizeStart={() => {
          release.current?.()
          release.current = acquireWebviewsDragPassthrough()
        }}
        onResizeEnd={() => {
          release.current?.()
          release.current = null
        }}
        onRatioChange={(ratio) =>
          useAppStore.getState().setTabGroupSplitRatio(context, path, ratio)
        }
      />
      <div className="flex min-h-0 min-w-0" style={{ flex: 1 - (node.ratio ?? 0.5) }}>
        <BrowserLayout
          context={context}
          node={node.second}
          path={path ? `${path}.second` : 'second'}
        />
      </div>
    </div>
  )
}
export function BrowserWorkspaceApp(): React.JSX.Element {
  const context = useAppStore((state) => state.activeWorktreeId)
  const layout = useAppStore((state) => (context ? state.layoutByWorktree[context] : null))
  const group = useAppStore((state) => (context ? state.groupsByWorktree[context]?.[0] : null))
  const contextRecord = useJavisContexts((state) => (context ? state.contexts[context] : undefined))
  const settings = useAppStore((state) => state.settings)
  const view = useAppStore((state) => state.activeView)
  const settingsSearchInputQuery = useAppStore((state) => state.settingsSearchInputQuery)
  const state = useAppStore.getState()
  const drag = useTabDragSplit({ worktreeId: context ?? '', enabled: view !== 'settings' })
  const [persistenceError, setPersistenceError] = useState(false)
  useEffect(() => {
    const handler = (): void => setPersistenceError(true)
    window.addEventListener('javis-browser-persistence-error', handler)
    return () => window.removeEventListener('javis-browser-persistence-error', handler)
  }, [])
  if (contextRecord?.available === false)
    return (
      <div
        role="alert"
        className="flex h-screen items-center justify-center bg-background text-foreground"
      >
        The context owner is unavailable. Reconnect its host before continuing.
      </div>
    )
  if (!context || !settings) return <div role="status">Loading browser workspace…</div>
  return (
    <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <header className="titlebar-traffic-light-pad flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="flex-1 text-xs text-muted-foreground">Javis</span>
        {persistenceError && (
          <span role="alert" className="text-xs text-destructive">
            Workspace changes could not be saved.
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.dispatchEvent(new Event('orca-toggle-floating-terminal'))}
        >
          Floating workspace
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Browser settings"
          onClick={() => state.openSettingsPage()}
        >
          <Settings className="size-4" />
        </Button>
      </header>
      {view === 'settings' ? (
        <div className="settings-view-shell scrollbar-sleek min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-[720px] space-y-6 px-8 py-6">
            <Button variant="ghost" onClick={() => state.closeSettingsPage()}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Input
              aria-label="Search browser settings"
              placeholder="Search settings"
              value={settingsSearchInputQuery}
              onChange={(event) => state.setSettingsSearchQuery(event.target.value)}
            />
            <BrowserSettingsPane
              settings={settings}
              updateSettings={(updates) => void state.updateSettings(updates)}
            />
          </div>
        </div>
      ) : null}
      <div
        className={
          view === 'settings'
            ? 'pointer-events-none absolute inset-x-0 top-9 bottom-0 flex min-h-0 flex-col opacity-0'
            : 'relative flex min-h-0 flex-1'
        }
      >
        <BrowserDragContext.Provider value={drag}>
          <DndContext
            sensors={drag.sensors}
            collisionDetection={drag.collisionDetection}
            onDragStart={drag.onDragStart}
            onDragMove={drag.onDragMove}
            onDragOver={drag.onDragOver}
            onDragEnd={drag.onDragEnd}
            onDragCancel={drag.onDragCancel}
          >
            <div ref={drag.setDragRootNode} className="relative flex min-h-0 flex-1">
              {layout ? (
                <BrowserLayout context={context} node={layout} />
              ) : group ? (
                <BrowserGroup context={context} groupId={group.id} />
              ) : null}
              <BrowserPaneOverlayLayer
                worktreeId={context}
                isWorktreeActive={view !== 'settings'}
              />
            </div>
          </DndContext>
        </BrowserDragContext.Provider>
      </div>
      <BackgroundBrowserContexts />
      <FloatingBrowserWorkspace />
    </div>
  )
}
