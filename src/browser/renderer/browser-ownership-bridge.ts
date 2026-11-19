import { hydrateBrowserDrivers, setDriverForBrowserPage } from '../source/renderer/src/runtime/browser/ownership/browser-mobile-driver-state'
import { hydrateBrowserRemoteViewerPages, setRemoteViewersForBrowserPage } from '../source/renderer/src/runtime/browser/ownership/browser-remote-viewer-store'
import { applyClientHostedBrowserRows, hydrateClientHostedBrowserRows } from '../source/renderer/src/runtime/browser/client-hosting/client-hosted-browser-row-state'
export function installBrowserOwnershipBridge(): () => void {
  const api = window.api.runtime
  let disposed = false, revision = 0, ready = false
  let pending: (() => void)[] = []
  const apply = (operation: () => void): void => { if (ready) operation(); else { pending.push(operation); if (pending.length > 300) pending.shift() } }
  const unsubs = [api.onBrowserDriverChanged((event) => apply(() => setDriverForBrowserPage(event.browserPageId, event.driver))), api.onBrowserRemoteViewersChanged!((event) => apply(() => setRemoteViewersForBrowserPage(event.browserPageId, event.hasRemoteViewers))), api.onClientHostedBrowserRowsChanged((event) => apply(() => applyClientHostedBrowserRows(event)))]
  const refresh = async (): Promise<void> => {
    const own = ++revision; ready = false
    try {
      const [drivers, viewers, rows] = await Promise.all([api.getBrowserDrivers(), api.getBrowserRemoteViewerPages!(), api.getClientHostedBrowserRows()])
      if (disposed || own !== revision) return
      hydrateBrowserDrivers(drivers); hydrateBrowserRemoteViewerPages(viewers); hydrateClientHostedBrowserRows(rows)
      ready = true; for (const event of pending) event(); pending = []
    } catch { if (!disposed) window.dispatchEvent(new Event('javis-browser-ownership-error')) }
  }
  window.addEventListener('online', refresh)
  void refresh()
  return () => { disposed = true; revision++; pending = []; unsubs.forEach((unsubscribe) => unsubscribe()); window.removeEventListener('online', refresh) }
}
