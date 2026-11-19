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
  let disposed = false, revision = 0
  const refresh = async (): Promise<void> => { const own = ++revision; const rows = await bridge.call('browser.annotations.list', { context: useAppStore.getState().activeWorktreeId, includeAcknowledged: true }); if (!disposed && own === revision && Array.isArray(rows)) reconcileAnnotationDeliveries(rows as AnnotationDelivery[]) }
  const unsubscribe = bridge.onEvent((event) => { if (event.method === 'browser.annotations.acknowledged' || event.method === 'browser.annotations.changed') void refresh().catch(() => {}) })
  window.addEventListener('online', refresh); void refresh().catch(() => {})
  return () => { disposed = true; revision++; unsubscribe(); window.removeEventListener('online', refresh) }
}
