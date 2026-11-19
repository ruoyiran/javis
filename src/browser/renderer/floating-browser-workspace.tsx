import BrowserPaneOverlayLayer from '../source/renderer/src/components/browser-pane/assemble-chrome/BrowserPaneOverlayLayer'
import { persistFloatingTerminalPanelOpen, persistFloatingTerminalPanelMaximized, readPersistedFloatingTerminalPanelViewState } from '../source/renderer/src/components/floating-terminal/floating-terminal-panel-view-state'
import { useState, useRef, useEffect } from 'react'
import { DndContext } from '@dnd-kit/core'
import { Minus, Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '../source/renderer/src/components/ui/button'
import { useAppStore } from '../source/renderer/src/store'
import { FLOATING_TERMINAL_WORKTREE_ID as context } from '../source/shared/constants'
import { TOGGLE_FLOATING_TERMINAL_EVENT, consumeFloatingTerminalOpenMaximizedIntent } from '../source/renderer/src/components/floating-terminal/floating-terminal'
import { FloatingTerminalResizeHandles } from '../source/renderer/src/components/floating-terminal/FloatingTerminalResizeHandles'
import { getDefaultFloatingTerminalBounds, getMaximizedFloatingTerminalBounds, readPersistedFloatingTerminalPanelBounds, resolveFloatingTerminalPanelCommittedBounds, persistFloatingTerminalPanelBounds } from '../source/renderer/src/components/floating-terminal/floating-terminal-panel-bounds'
import { useTabDragSplit } from '../source/renderer/src/components/tab-group/useTabDragSplit'
import { BrowserLayout, BrowserDragContext } from './browser-workspace-app'
export function FloatingBrowserWorkspace(): React.JSX.Element {
  const open = useAppStore((state) => state.floatingWorkspacePanelOpen), layout = useAppStore((state) => state.layoutByWorktree[context])
  const [maximized, setMaximized] = useState(readPersistedFloatingTerminalPanelViewState()?.maximized ?? false), [bounds, setBounds] = useState(() => { const saved = readPersistedFloatingTerminalPanelBounds(); return saved ? resolveFloatingTerminalPanelCommittedBounds(saved) : getDefaultFloatingTerminalBounds() })
  const node = useRef<HTMLDivElement>(null), start = useRef<{x:number;y:number;left:number;top:number} | null>(null)
  const drag = useTabDragSplit({worktreeId:context, enabled:open})
  useEffect(() => { const toggle = () => { const state = useAppStore.getState(); const next = !state.floatingWorkspacePanelOpen; useAppStore.setState({floatingWorkspacePanelOpen:next}); persistFloatingTerminalPanelOpen(next); if (next) { if (!state.browserTabsByWorktree[context]?.length) state.createBrowserTab(context,'about:blank'); if (consumeFloatingTerminalOpenMaximizedIntent()) setMaximized(true); requestAnimationFrame(() => node.current?.focus()) } }; window.addEventListener(TOGGLE_FLOATING_TERMINAL_EVENT,toggle); return () => window.removeEventListener(TOGGLE_FLOATING_TERMINAL_EVENT,toggle) }, [])
  useEffect(() => { persistFloatingTerminalPanelMaximized(maximized) }, [maximized])
  const visible = maximized ? getMaximizedFloatingTerminalBounds() : bounds
  return <div ref={node} data-floating-terminal-panel data-javis-floating tabIndex={-1} aria-hidden={!open} className={`fixed z-[45] flex min-h-[280px] min-w-[420px] flex-col rounded-lg border border-border bg-card text-card-foreground shadow-floating ${open ? '' : 'invisible pointer-events-none'}`} style={visible}>
    <div className="flex h-9 shrink-0 cursor-grab items-center border-b border-border px-2" onDoubleClick={(event) => {if(!(event.target instanceof Element && event.target.closest('button')))setMaximized(!maximized)}} onPointerDown={(event) => { if (event.target instanceof Element && event.target.closest('button')) return; start.current={x:event.clientX,y:event.clientY,left:bounds.left,top:bounds.top}; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={(event) => {if (!start.current || maximized) return; setBounds({...bounds,left:start.current.left+event.clientX-start.current.x,top:start.current.top+event.clientY-start.current.y})}} onPointerUp={() => {start.current=null;persistFloatingTerminalPanelBounds(bounds)}}><span className="flex-1 text-xs">Javis workspace</span><Button size="icon-xs" variant="ghost" aria-label="Maximize floating workspace" onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 /> : <Maximize2 />}</Button><Button size="icon-xs" variant="ghost" aria-label="Minimize floating workspace" onClick={() => window.dispatchEvent(new Event(TOGGLE_FLOATING_TERMINAL_EVENT))}><Minus /></Button></div>
    <BrowserDragContext.Provider value={drag}><DndContext sensors={drag.sensors} collisionDetection={drag.collisionDetection} onDragStart={drag.onDragStart} onDragMove={drag.onDragMove} onDragEnd={drag.onDragEnd} onDragCancel={drag.onDragCancel}><div ref={drag.setDragRootNode} className="relative flex min-h-0 flex-1">{layout && <BrowserLayout context={context} node={layout}/>}<BrowserPaneOverlayLayer worktreeId={context} isWorktreeActive={open}/></div></DndContext></BrowserDragContext.Provider>
    {!maximized && <FloatingTerminalResizeHandles bounds={bounds} onPreviewBounds={setBounds} onCommitBounds={() => persistFloatingTerminalPanelBounds(bounds)} />}
  </div>
}
