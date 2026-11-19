import { registerBrowserStateIpcBridge } from '../source/renderer/src/hooks/ipc-events/browser-state-ipc-bridge'
import { registerBrowserRequestIpcBridge, signalBrowserTabRequestsReadyAfterRestore } from '../source/renderer/src/hooks/ipc-events/browser-request-ipc-bridge'
import { registerBrowserTabActivateIpcBridge } from '../source/renderer/src/hooks/ipc-events/browser-tab-activate-ipc-bridge'
import { useAppStore } from '../source/renderer/src/store'
import type { AppState } from '../source/renderer/src/store/types'
import type { GlobalSettings } from '../source/shared/global-settings-types'
import type { WorkspaceSessionState } from '../source/shared/workspace-session/workspace-session-state-types'
import { getDefaultWorkspaceSession, FLOATING_TERMINAL_WORKTREE_ID } from '../source/shared/constants'
import { hydrateJavisContexts, type JavisContext } from '../source/renderer/src/store/workspaces/javis-context-catalog'
import { hydrateWorkspaceSession, serializeWorkspaceSession } from './workspace-session-state'
import { ensureBrowserClientHostsForRestoredPages } from '../source/renderer/src/runtime/browser/client-hosting/restored-client-hosted-browser-host-attach'
import { installBrowserOwnershipBridge } from './browser-ownership-bridge'
import { installAnnotationDeliveryBridge } from './context-annotation-delivery'
import { installWorkspaceShortcuts } from './workspace-shortcuts'
export type BrowserWorkspaceBootstrap = { context: string; generation: number; host?: string; contexts?: JavisContext[]; settings: GlobalSettings; session?: WorkspaceSessionState; runtimeEnvironments?: AppState['runtimeEnvironments']; ui?: Record<string, unknown> }
export type JavisBrowserBridge = { bootstrap(): Promise<BrowserWorkspaceBootstrap>; persistWorkspace(session: WorkspaceSessionState): Promise<unknown>; call(method: string, params: Record<string, unknown>): Promise<unknown>; onEvent(callback: (event: { method: string; params: Record<string, unknown> }) => void): () => void }
export function browserBridge(): JavisBrowserBridge { const bridge = (window as unknown as { api: { javisBrowser?: JavisBrowserBridge } }).api.javisBrowser; if (!bridge) throw new Error('Javis browser preload is unavailable'); return bridge }
let carried: WorkspaceSessionState = getDefaultWorkspaceSession()
export function captureBrowserWorkspace(): WorkspaceSessionState { return serializeWorkspaceSession(useAppStore.getState(), carried) }
export type WorkspaceLifetime = { checkpoint(): Promise<void>; dispose(): Promise<void> }
export async function bootstrapBrowserWorkspace(): Promise<WorkspaceLifetime> {
  const bridge = browserBridge(), bootstrap = await bridge.bootstrap()
  if (!bootstrap.context || !Number.isSafeInteger(bootstrap.generation)) throw new Error('Javis browser ownership revision is missing')
  carried = bootstrap.session ?? getDefaultWorkspaceSession()
  const contexts = bootstrap.contexts ?? [{ id: bootstrap.context, owner: { kind: 'local' as const } }]
  hydrateJavisContexts([...contexts, { id: FLOATING_TERMINAL_WORKTREE_ID, owner: { kind: 'local' } }])
  useAppStore.setState({ ...(bootstrap.ui ?? await window.api.ui.get()), settings: bootstrap.settings, activeWorktreeId: bootstrap.context, activeView: 'terminal', persistedUIReady: true, runtimeEnvironments: bootstrap.runtimeEnvironments ?? [], runtimeEnvironmentCatalogHydrated: true } as Partial<AppState>)
  useAppStore.setState(hydrateWorkspaceSession(useAppStore.getState(), carried, bootstrap.context, new Set([...contexts.map((row) => row.id), FLOATING_TERMINAL_WORKTREE_ID])))
  await useAppStore.getState().fetchBrowserSessionProfiles()

  void ensureBrowserClientHostsForRestoredPages(useAppStore.getState())
  let disposed = false, pending: WorkspaceSessionState | null = null, writing: Promise<void> | null = null
  const flush = (): Promise<void> => writing ??= (async () => {
    try { while (pending) { const snapshot = pending; pending = null; await bridge.persistWorkspace(snapshot); carried = snapshot } }
    catch (error) { window.dispatchEvent(new CustomEvent('javis-browser-persistence-error', { detail: error })); throw error }
    finally { writing = null }
  })()
  const persistedFields: readonly (keyof AppState)[] = ['openFiles','editorDrafts','unifiedTabsByWorktree','groupsByWorktree','layoutByWorktree','activeGroupIdByWorktree','browserTabsByWorktree','browserPagesByWorkspace','browserAnnotationsByPageId','remoteBrowserPageHandlesByPageId','activeBrowserTabIdByWorktree','activeTabTypeByWorktree','activeFileIdByWorktree','activeWorktreeId','browserUrlHistory','workspaceDocHistory','clientHostedBrowserCloseIntentsByEnvironment']
  const unsubscribe = useAppStore.subscribe((next, previous) => {
    if (disposed || next === previous || persistedFields.every((field)=>next[field]===previous[field])) return
    const snapshot = serializeWorkspaceSession(next, carried)
    if (JSON.stringify(snapshot) === JSON.stringify(serializeWorkspaceSession(previous, carried))) return
    pending = snapshot; void flush().catch(() => {})
  })
  if (!useAppStore.getState().browserTabsByWorktree[bootstrap.context]?.length && !useAppStore.getState().openFiles.some((file) => file.worktreeId === bootstrap.context)) useAppStore.getState().createBrowserTab(bootstrap.context, useAppStore.getState().browserDefaultUrl ?? 'about:blank', { focusAddressBar: true })
  const browserSubscriptions: (()=>void)[] = []
  registerBrowserStateIpcBridge(browserSubscriptions,()=>bootstrap.host!=='local')
  registerBrowserRequestIpcBridge(browserSubscriptions)
  registerBrowserTabActivateIpcBridge(browserSubscriptions)
  useAppStore.setState({workspaceSessionReady:true})
  signalBrowserTabRequestsReadyAfterRestore(browserSubscriptions)
  const ownership = installBrowserOwnershipBridge(), annotations = installAnnotationDeliveryBridge(), shortcuts = installWorkspaceShortcuts()
  const settingsSubscription = window.api.settings.onChanged((patch)=>useAppStore.setState((state)=>({settings:state.settings ? {...state.settings,...patch} : state.settings})))
  const unsubscribeEvents = bridge.onEvent((event) => {
    if (event.method === 'browser.contextChanged' && event.params.context !== bootstrap.context) { disposed = true; void flush().finally(() => window.location.reload()) }
    if (event.method === 'browser.contextCatalogChanged' && Array.isArray(event.params.contexts)) hydrateJavisContexts(event.params.contexts as JavisContext[])
  })
  return { checkpoint: async () => { pending = captureBrowserWorkspace(); await flush(); await window.api.app.awaitBeforeUnloadCheckpoint?.() }, dispose: async () => { pending = captureBrowserWorkspace(); await flush(); disposed = true; unsubscribe(); unsubscribeEvents(); settingsSubscription(); ownership(); annotations(); shortcuts(); browserSubscriptions.forEach((unsubscribe)=>unsubscribe()) } }
}
