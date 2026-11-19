import { annotationDeliveryContexts } from './annotation-delivery-contexts'
import { useAppStore } from '../source/renderer/src/store'
import type { BrowserPageAnnotation } from '../source/shared/browser/element-grab/browser-grab-types'
import { browserBridge } from './workspace-bootstrap'
import { acknowledgedAnnotationObjects, type AnnotationDelivery } from './annotation-delivery-reconciliation'
export function reconcileAnnotationDeliveries(deliveries: AnnotationDelivery[]): void {
 const state = useAppStore.getState()
 for (const [page, notes] of Object.entries(acknowledgedAnnotationObjects(deliveries, state.browserAnnotationsByPageId))) state.removeDeliveredBrowserPageAnnotations(page, notes)
}
export function installAnnotationDeliveryBridge(): () => void {
  const bridge = browserBridge()
  let disposed=false
  const revisions=new Map<string,number>()
  const refresh = async (specific?:string):Promise<void> => {
    const state=useAppStore.getState()
    const contexts=specific?[specific]:annotationDeliveryContexts(state.browserPagesByWorkspace,state.browserAnnotationsByPageId,state.activeWorktreeId)
    await Promise.all(contexts.map(async(context)=>{
      const revision=(revisions.get(context)??0)+1;revisions.set(context,revision)
      const rows=await bridge.call('browser.annotations.list',{context,includeAcknowledged:true})
      if(!disposed && revisions.get(context)===revision && Array.isArray(rows))reconcileAnnotationDeliveries(rows as AnnotationDelivery[])
    }))
  }
  const online=()=>{void refresh().catch(()=>{})}
  const unsubscribe=bridge.onEvent((event)=>{if(event.method==='browser.annotations.acknowledged'||event.method==='browser.annotations.changed')void refresh(typeof event.params.context==='string'?event.params.context:undefined).catch(()=>{})})
  const unsubscribeStore=useAppStore.subscribe((next,prior)=>{if(next.browserPagesByWorkspace!==prior.browserPagesByWorkspace || next.browserAnnotationsByPageId!==prior.browserAnnotationsByPageId)void refresh().catch(()=>{})})
  window.addEventListener('online',online);void refresh().catch(()=>{})
  return()=>{disposed=true;revisions.clear();unsubscribe();unsubscribeStore();window.removeEventListener('online',online)}
}
