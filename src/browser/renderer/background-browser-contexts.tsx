import {backgroundBrowserContexts} from './background-browser-context-selection'
import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import BrowserPaneOverlayLayer from '../source/renderer/src/components/browser-pane/assemble-chrome/BrowserPaneOverlayLayer'
import { browserPageNeedsPaintRetention, onBrowserGuestPaintRetentionChange } from '../source/renderer/src/components/browser-pane/host-guest/browser-guest-paint-retention'
import { takeAllPendingBackgroundTerminalWorktreeMounts, subscribeBackgroundTerminalWorktreeMountRequests } from '../source/renderer/src/components/terminal/background-terminal-worktree-mount'
import { BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT } from '../source/renderer/src/constants/terminal'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../source/shared/constants'
import { useAppStore } from '../source/renderer/src/store'
import { javisContext } from '../source/renderer/src/store/workspaces/javis-context-catalog'
import type { BrowserPage } from '../source/shared/browser-workspace-types'
import { BrowserLayout } from './browser-workspace-app'
export function BackgroundBrowserContexts(): React.JSX.Element {
  const {pages,active,layouts}=useAppStore(useShallow((state)=>({pages:state.browserPagesByWorkspace,active:state.activeWorktreeId,layouts:state.layoutByWorktree})))
  const [requested,setRequested]=useState<Set<string>>(()=>new Set()), [,setPaintRevision]=useState(0)
  useEffect(()=>{
    const take=()=>{const requests=takeAllPendingBackgroundTerminalWorktreeMounts();if(requests.length)setRequested((prior)=>new Set([...prior,...requests.map((row)=>row.worktreeId)]))}
    const unsubscribe=subscribeBackgroundTerminalWorktreeMountRequests(take)
    window.addEventListener(BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,take);take()
    const paint=onBrowserGuestPaintRetentionChange(()=>setPaintRevision((value)=>value+1))
    return()=>{unsubscribe();paint();window.removeEventListener(BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,take)}
  },[])
  const contexts=backgroundBrowserContexts(pages,requested,active,browserPageNeedsPaintRetention)
  return <>{contexts.map((context)=>javisContext(context)?.available===false || !layouts[context] ? null : <div key={context} className="pointer-events-none absolute inset-x-0 top-9 bottom-0 flex min-h-0 opacity-0"><BrowserLayout context={context} node={layouts[context]}/><BrowserPaneOverlayLayer worktreeId={context} isWorktreeActive={false}/></div>)}</>
}
