import { useCallback } from 'react'
import type { TabGroupLayoutNode } from '../source/shared/tab-types'
import { tabGroupBodyAnchorName } from '../source/renderer/src/components/tab-group/tab-group-body-anchor'
import { registerTabGroupBody } from '../source/renderer/src/components/tab-group/tab-group-body-geometry'
function BrowserPaintBody({context,groupId}:{context:string;groupId:string}):React.JSX.Element {
  const bodyRef=useCallback((node:HTMLDivElement|null)=>node?registerTabGroupBody(groupId,node):undefined,[groupId])
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col"><div className="h-9 shrink-0"/><div ref={bodyRef} data-tab-group-body-id={groupId} data-worktree-id={context} style={{anchorName:tabGroupBodyAnchorName(groupId)}} className="relative min-h-0 flex-1"/></section>
}
/** Paint leases need browser geometry, never another context's editor lifecycle. */
export function BackgroundBrowserLayout({context,node}:{context:string;node:TabGroupLayoutNode}):React.JSX.Element {
  if(node.type==='leaf')return <BrowserPaintBody context={context} groupId={node.groupId}/>
  return <div className={`flex min-h-0 min-w-0 flex-1 ${node.direction==='horizontal'?'flex-row':'flex-col'}`}><div className="flex min-h-0 min-w-0" style={{flex:node.ratio??0.5}}><BackgroundBrowserLayout context={context} node={node.first}/></div><div className="flex min-h-0 min-w-0" style={{flex:1-(node.ratio??0.5)}}><BackgroundBrowserLayout context={context} node={node.second}/></div></div>
}
