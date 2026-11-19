import { useAppStore } from '../source/renderer/src/store'
import type { AppState } from '../source/renderer/src/store/types'
import type { GlobalSettings } from '../source/shared/global-settings-types'
import type { WorkspaceSessionState } from '../source/shared/workspace-session/workspace-session-state-types'
import { admitBrowserPageMount } from '../source/renderer/src/components/browser-pane/host-guest/browser-page-mount-admission'

export type BrowserWorkspaceBootstrap = {
  context: string
  host?: string
  settings: GlobalSettings
  session?: WorkspaceSessionState
  runtimeEnvironments?: AppState['runtimeEnvironments']
  ui?: Record<string, unknown>
}
export type JavisBrowserBridge = {
  bootstrap(): Promise<BrowserWorkspaceBootstrap>
  persistWorkspace(session: Record<string, unknown>): Promise<void>
  call(method: string, params: Record<string, unknown>): Promise<unknown>
  onEvent(callback: (event: { method: string; params: Record<string, unknown> }) => void): () => void
}
export function browserBridge(): JavisBrowserBridge {
  const bridge = (window as unknown as { api: { javisBrowser?: JavisBrowserBridge } }).api.javisBrowser
  if (!bridge) throw new Error('Javis browser preload is unavailable')
  return bridge
}
const sessionFields = [
  'browserTabsByWorktree', 'browserPagesByWorkspace', 'activeBrowserTabIdByWorktree',
  'unifiedTabsByWorktree', 'groupsByWorktree', 'layoutByWorktree', 'activeGroupIdByWorktree',
  'browserUrlHistory', 'workspaceDocHistory', 'browserAnnotationsByPageId',
  'browserAnnotationMarkerIdsByPageId', 'remoteBrowserPageHandlesByPageId',
  'recentlyClosedBrowserTabsByWorktree', 'recentlyClosedBrowserPagesByWorkspace', 'recentlyClosedTabKindsByWorktree'
] as const
export function captureBrowserWorkspace(): Record<string, unknown> {
  const state = useAppStore.getState()
  return Object.fromEntries(sessionFields.map((field) => [field, state[field]]))
}
export async function bootstrapBrowserWorkspace(): Promise<() => void> {
  const bridge = browserBridge()
  const bootstrap = await bridge.bootstrap()
  const persistedUi = bootstrap.ui ?? await window.api.ui.get()
  if (!bootstrap.context) throw new Error('Javis browser context is missing')
  const session = bootstrap.session as Record<string, unknown> | undefined
  const saved = Object.fromEntries(sessionFields.filter((field) => session?.[field] !== undefined).map((field) => [field, session![field]]))
  useAppStore.setState({ ...saved, ...persistedUi, settings: bootstrap.settings,
    activeWorktreeId: bootstrap.context, activeView: 'terminal', persistedUIReady: true,
    runtimeEnvironments: bootstrap.runtimeEnvironments ?? [], runtimeEnvironmentCatalogHydrated: true,
  } as Partial<AppState>)
  await useAppStore.getState().fetchBrowserSessionProfiles()
  const state = useAppStore.getState()
  if (!state.browserTabsByWorktree[bootstrap.context]?.length) {
    state.createBrowserTab(bootstrap.context, state.browserDefaultUrl ?? 'about:blank', { focusAddressBar: true })
  }
  for (const pages of Object.values(useAppStore.getState().browserPagesByWorkspace)) {
    for (const page of pages) admitBrowserPageMount(page.id)
  }
  let disposed = false
  let pending = false
  let writing = false
  const flush = async (): Promise<void> => {
    if (writing || disposed) return
    writing = true
    try {
      while (pending && !disposed) { pending = false; await bridge.persistWorkspace(captureBrowserWorkspace()) }
    } catch (error) { window.dispatchEvent(new CustomEvent('javis-browser-persistence-error', { detail: error })) }
    finally { writing = false }
  }
  const unsubscribeEvents = bridge.onEvent((event) => {
    if (event.method === 'browser.contextChanged' && event.params.context !== useAppStore.getState().activeWorktreeId) window.location.reload()
  })
  const unsubscribe = useAppStore.subscribe((next, previous) => {
    if (!sessionFields.some((field) => next[field] !== previous[field])) return
    pending = true; void flush()
  })
  return () => { disposed = true; unsubscribe(); unsubscribeEvents() }
}
