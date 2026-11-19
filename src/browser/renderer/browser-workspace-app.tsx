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
import { Tooltip, TooltipContent, TooltipTrigger } from '../source/renderer/src/components/ui/tooltip'
import { useTabDragSplit } from '../source/renderer/src/components/tab-group/useTabDragSplit'
import type { TabGroupLayoutNode } from '../source/shared/tab-types'
import { useTranslate } from '../source/renderer/src/i18n/use-translate'

function BrowserGroup({ context, groupId }: { context: string; groupId: string }): React.JSX.Element {
  const state = useAppStore()
  const t = useTranslate()
  const group = state.groupsByWorktree[context]?.find((item) => item.id === groupId)
  const tabs = (state.unifiedTabsByWorktree[context] ?? []).filter((tab) => tab.groupId === groupId && tab.contentType === 'browser').sort((a, b) => a.sortOrder - b.sortOrder)
  const focused = state.activeGroupIdByWorktree[context] === groupId
  const active = tabs.find((tab) => tab.id === group?.activeTabId) ?? tabs[0]
  const close = (id: string, bulk = false): void => { dispatchWorkspaceTabCommand({ type: 'close', target: { kind: 'browser-source', sourceId: id }, bulk }) }
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" onPointerDown={() => state.focusGroup(context, groupId)}>
    <div className="flex h-9 shrink-0 items-center border-b border-border bg-background">
      <div className="scrollbar-sleek flex min-w-0 flex-1 overflow-x-auto">
        <SortableContext items={tabs.map((tab) => tab.entityId)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, index) => {
            const browser = state.browserTabsByWorktree[context]?.find((item) => item.id === tab.entityId)
            if (!browser) return null
            return <BrowserTab key={browser.id} tab={browser} isActive={active?.id === tab.id} isPinned={tab.isPinned === true}
              hasTabsToLeft={index > 0} hasTabsToRight={index < tabs.length - 1} tabCount={tabs.length}
              dragData={{ kind: 'tab', tabType: 'browser', visibleTabId: browser.id, unifiedTabId: tab.id, groupId, worktreeId: context, label: tab.label }}
              onActivate={() => { state.activateTab(tab.id); state.setActiveBrowserTab(browser.id) }}
              onClose={() => close(browser.id)} onCloseOthers={() => tabs.filter((item) => item.id !== tab.id && !item.isPinned).forEach((item) => close(item.entityId, true))}
              onCloseToLeft={() => tabs.slice(0, index).filter((item) => !item.isPinned).forEach((item) => close(item.entityId, true))}
              onCloseToRight={() => tabs.slice(index + 1).filter((item) => !item.isPinned).forEach((item) => close(item.entityId, true))}
              onDuplicate={() => state.createBrowserTab(context, browser.url, { sessionProfileId: browser.sessionProfileId, targetGroupId: groupId })}
              onTogglePin={() => tab.isPinned ? state.unpinTab(tab.id) : state.pinTab(tab.id)}
              onCloseSplitPane={() => (() => { tabs.filter((item) => !item.isPinned).forEach((item) => close(item.entityId, true)); state.closeEmptyGroup(context, groupId) })()} />
          })}
        </SortableContext>
      </div>
      <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('browser.newTab', 'New Tab')} onClick={() => void state.openNewBrowserTabInActiveWorkspace(groupId)}><Plus className="size-4" /></Button></TooltipTrigger><TooltipContent>{t('browser.newTab', 'New Tab')}</TooltipContent></Tooltip>
    </div>
    {(state.browserTabsByWorktree[context] ?? []).filter((browser) => tabs.some((tab) => tab.entityId === browser.id)).map((browser) => <div key={browser.id} className={active?.entityId === browser.id ? 'flex min-h-0 flex-1' : 'hidden'}><BrowserPane browserTab={browser} isActive={active?.entityId === browser.id} chromeShortcutScope={focused && active?.entityId === browser.id ? 'focused' : 'inactive'} /></div>)}
  </section>
}
function BrowserLayout({ context, node, path = '' }: { context: string; node: TabGroupLayoutNode; path?: string }): React.JSX.Element {
  const release = useRef<(() => void) | null>(null)
  useEffect(() => () => release.current?.(), [])
  if (node.type === 'leaf') return <BrowserGroup context={context} groupId={node.groupId} />
  return <div className={`flex min-h-0 min-w-0 flex-1 ${node.direction === 'horizontal' ? 'flex-row' : 'flex-col'}`}>
    <div className="flex min-h-0 min-w-0" style={{ flex: node.ratio ?? 0.5 }}><BrowserLayout context={context} node={node.first} path={path ? `${path}.first` : 'first'} /></div>
    <ResizeHandle direction={node.direction} onResizeStart={() => { release.current?.(); release.current = acquireWebviewsDragPassthrough() }} onResizeEnd={() => { release.current?.(); release.current = null }} onRatioChange={(ratio) => useAppStore.getState().setTabGroupSplitRatio(context, path, ratio)} />
    <div className="flex min-h-0 min-w-0" style={{ flex: 1 - (node.ratio ?? 0.5) }}><BrowserLayout context={context} node={node.second} path={path ? `${path}.second` : 'second'} /></div>
  </div>
}
export function BrowserWorkspaceApp(): React.JSX.Element {
  const context = useAppStore((state) => state.activeWorktreeId)
  const layout = useAppStore((state) => context ? state.layoutByWorktree[context] : null)
  const group = useAppStore((state) => context ? state.groupsByWorktree[context]?.[0] : null)
  const settings = useAppStore((state) => state.settings)
  const view = useAppStore((state) => state.activeView)
  const state = useAppStore.getState()
  const drag = useTabDragSplit({ worktreeId: context ?? '', enabled: view !== 'settings' })
  const [persistenceError, setPersistenceError] = useState(false)
  useEffect(() => { const handler = (): void => setPersistenceError(true); window.addEventListener('javis-browser-persistence-error', handler); return () => window.removeEventListener('javis-browser-persistence-error', handler) }, [])
  if (!context || !settings) return <div role="status">Loading browser workspace…</div>
  return <div className="flex h-screen min-h-0 flex-col bg-background text-foreground">
    <header className="titlebar-traffic-light-pad flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
      <span className="flex-1 text-xs text-muted-foreground">Javis</span>
      {persistenceError && <span role="alert" className="text-xs text-destructive">Workspace changes could not be saved.</span>}
      <Button variant="ghost" size="icon-sm" aria-label="Browser settings" onClick={() => state.openSettingsPage()}><Settings className="size-4" /></Button>
    </header>
    {view === 'settings' ? <div className="settings-view-shell scrollbar-sleek min-h-0 flex-1 overflow-auto"><div className="mx-auto max-w-[720px] space-y-6 px-8 py-6"><Button variant="ghost" onClick={() => state.closeSettingsPage()}><ArrowLeft className="size-4" />Back</Button><Input aria-label="Search browser settings" placeholder="Search settings" value={state.settingsSearchQuery} onChange={(event) => state.setSettingsSearchQuery(event.target.value)} /><BrowserSettingsPane settings={settings} updateSettings={(updates) => void state.updateSettings(updates)} /></div></div> :
    <DndContext sensors={drag.sensors} collisionDetection={drag.collisionDetection} onDragStart={drag.onDragStart} onDragMove={drag.onDragMove} onDragOver={drag.onDragOver} onDragEnd={drag.onDragEnd} onDragCancel={drag.onDragCancel}><div ref={drag.setDragRootNode} className="flex min-h-0 flex-1">{layout ? <BrowserLayout context={context} node={layout} /> : group ? <BrowserGroup context={context} groupId={group.id} /> : null}</div></DndContext>}
  </div>
}
