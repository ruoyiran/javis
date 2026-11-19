import { BrowserStreamDelivery } from './stream-delivery'
import { KeybindingService } from '../source/main/keybindings/keybinding-service'
import { ClientHostedBrowserRowPublisher } from '../source/main/runtime/browser/client-pages/client-hosted-browser-row-publication'
import { BrowserWorkspaceSessions, browserContextId } from './workspace-sessions'
import { RuntimeBrowserScreencastController } from '../source/main/runtime/browser/screencast/runtime-browser-screencast-controller'
import { RuntimeBrowserDriverController } from '../source/main/runtime/browser/driver/runtime-browser-driver-controller'
import { ServeBrowserTabs } from '../source/main/runtime/browser/headless/serve-browser-tabs'
import { findSavedBrowserPage } from '../source/main/runtime/browser/headless/serve-browser-tab-layout'
import { initializeBrowserSessionsForApp } from '../source/main/browser/sessions/browser-session-startup'
import { trackBrowserExtensionMainWindow } from '../source/main/browser/extensions/tabs-and-windows/browser-extension-window-model'
import { registerDocPreviewGrantHandlers } from '../source/main/ipc/doc-preview-grant-ipc'
import { installDocPreviewProtocolHandler } from '../source/main/browser/document-preview/doc-preview-protocol'
import { releaseBrowserClientDownloadTransfersForPage } from '../source/main/runtime/browser/downloads/browser-client-download-transfer-store'
import { retainRuntimeBrowserClientPageRecord } from '../source/main/runtime/browser/client-pages/runtime-browser-client-page-release'
import { setMainUiLanguage } from '../source/main/i18n/main-i18n'
import { normalizeExternalBrowserUrl } from '../source/shared/browser-url'
import { installMainWindowWebviewSecurity } from '../source/main/window/main-window-webview-security'
import { BROWSER_IDENTITY_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-identity-rpc'
import { initializeBrowserIdentityModeStore } from '../source/main/browser/identity/mode/browser-identity-mode-store'
import { BrowserHostBridge } from './host-bridge'
import { setBrowserHostTransport } from '../source/main/ipc/runtime-environments/runtime-environment-transport-routing'
import { initializeBrowserExtensionSupport, switchBrowserExtensionSupport } from '../source/main/browser/extensions/browser-extension-startup'
import { BROWSER_CLIENT_HOST_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-client-host'
import { BROWSER_SCREENCAST_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-screencast'
import { BrowserNetworkTunnelAttachParams } from '../source/shared/browser/client-hosting/browser-client-host-protocol'
import { browserNetworkExecutionHostKey } from '../source/shared/browser/client-hosting/browser-network-execution-host'
import { AnnotationQueue } from './annotation-queue'
import { getDefaultWorkspaceSession, getDefaultUIState, FLOATING_TERMINAL_WORKTREE_ID } from '../source/shared/constants'
import { app, BrowserWindow, ipcMain, clipboard, shell } from 'electron'
import { BrowserWorkspaceFiles } from './workspace-files'
import { BROWSER_CLIENT_FILE_CHANNEL_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-client-file-channel'
import { BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY, BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY } from '../source/shared/browser/runtime/browser-runtime-capabilities'
import { BROWSER_CLIENT_HOST_REQUEST_CAPABILITY } from '../source/shared/browser/client-hosting/browser-client-host-request-protocol'
import { isAbsolute } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { browserManager } from '../source/main/browser/guest-lifecycle/manager/browser-manager'
import { AgentBrowserBridge } from '../source/main/browser/agent-browser/agent-browser-bridge'
import { OffscreenBrowserBackend } from '../source/main/browser/backends/offscreen-browser-backend'
import { RuntimeBrowserCommands } from '../source/main/runtime/browser/commands/browser-commands'
import type { RuntimeBrowserCommandHost } from '../source/main/runtime/browser/commands/browser-command-contracts'
import { BrowserHostLeaseRegistry } from '../source/main/runtime/browser-host/leases/browser-host-lease-registry'
import { BrowserHostRequestRegistry } from '../source/main/runtime/browser-host/leases/browser-host-request-registry'
import { RuntimeBrowserPageRegistry } from '../source/main/runtime/browser/client-pages/runtime-browser-page-registry'
import { browserSessionRegistry } from '../source/main/browser/sessions/profiles/browser-session-registry'
import { registerBrowserHandlers, setAgentBrowserBridgeRef } from '../source/main/ipc/browser/browser'
import { setTrustedBrowserRendererWebContentsId } from '../source/main/ipc/browser/browser-renderer-trust'
import { watchBrowserMainWindowReadiness } from '../source/main/browser/guest-lifecycle/browser-main-window-readiness'
import { BROWSER_CORE_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-core'
import { BROWSER_EXTRA_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-extras'
import { installElectronBrowserCommands } from '../source/main/host/electron-browser-commands'
import { setAppEnvironment } from '../source/shared/app-environment'
import { ElectronAppEnvironment } from '../source/main/host/electron-app-environment'
import { Store } from '../source/main/persistence/loading-store/store'
import { BrowserError } from '../source/main/browser/browser-error'

export type BrowserCallParams = Record<string, unknown>
export type BrowserCall = (method: string, params: BrowserCallParams) => Promise<unknown>
export type BrowserService = { call: BrowserCall; shutdown(): Promise<void> }
export type BrowserServiceOptions = {
  dataDirectory: string
  background: boolean
  emit(event: { method: string; params: Record<string, unknown> }): void
}

export async function createBrowserService(options: BrowserServiceOptions): Promise<BrowserService> {
  setAppEnvironment(new ElectronAppEnvironment())
  mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 })
  let window: BrowserWindow | null = null
  let rendererId: number | null = null
  const emit = (event: { method: string; params: Record<string, unknown> }) => { options.emit(event); if (window && !window.isDestroyed()) window.webContents.send('javis:browser:event', event) }
  const workspace = new BrowserWorkspaceSessions(options.dataDirectory)
  const store = new Store()
  const hostBridge = new BrowserHostBridge(emit)
  setBrowserHostTransport((target, method, params, timeout) => hostBridge.call(target, method, params, timeout), (target, method, params, callbacks, config) => hostBridge.subscribe(target, method, params, callbacks, config))
  const uiSubscriptions = new Map<string, Awaited<ReturnType<BrowserHostBridge['subscribe']>>>()
  const annotations = new AnnotationQueue(join(options.dataDirectory, 'annotation-deliveries.json'))
  const runtimeId = randomUUID()
  const startedAt = Date.now()
  const subscriptions = new Map<string, { cleanup: () => void; connectionId: string }>()
  const connections = new Map<string, AbortController>()
  const delivery = new BrowserStreamDelivery(emit)
  const lifetime = new AbortController()
  const leases = new BrowserHostLeaseRegistry({ authorityRuntimeId: runtimeId,
    onClientPageReleased: (page, generation) => { void releaseBrowserClientDownloadTransfersForPage(callerRuntime, page, generation).catch(error => console.warn('[browser] Transfer cleanup failed', error.message)) },
    onClientPageFenced: (page, placement) => { retainRuntimeBrowserClientPageRecord(callerRuntime, page, placement) }
  })
  const requests = new BrowserHostRequestRegistry()
  const pages = new RuntimeBrowserPageRegistry()
  const bridge = new AgentBrowserBridge(browserManager)
  const offscreen = new OffscreenBrowserBackend(browserManager, {
    getAgentBrowserBridge: () => bridge,
    onPageNavigated: (page) => {
      serveTabs.navigated(page)
      emit({ method: 'browser.pageNavigated', params: page })
    }
  })
  const serveTabs = new ServeBrowserTabs({
    backend: () => offscreen,
    livePageIds: context => new Set(bridge.getRegisteredTabs(context).keys()),
    savedWorktreeIds: () => workspace.contexts(),
    session: context => workspace.session(context),
    hostId: () => 'local',
    save: (context, session) => workspace.save(context, session)
  })
  const host: RuntimeBrowserCommandHost = {
    getRuntimeId: () => runtimeId,
    getAgentBrowserBridge: () => bridge,
    resolveWorkspaceSelector: async (selector) => ({ id: browserContextId(selector), hostId: 'local' }),
    resolveBrowserWorkspace: async (selector) => ({ id: browserContextId(selector), hostId: 'local' }),
    resolveBrowserNetworkExecutionHost: () => ({ kind: 'native', runtimeId, revision: startedAt }),
    getBrowserHostLeaseRegistry: () => leases,
    getBrowserHostRequestRegistry: () => requests,
    getRuntimeBrowserPageRegistry: () => pages,
    getAuthoritativeWindow: () => { if (!window || window.isDestroyed()) throw new BrowserError('browser_host_unavailable', 'Browser workspace is closed'); return window },
    getAvailableAuthoritativeWindow: () => window && !window.isDestroyed() ? window : null,
    getOffscreenBrowserBackend: () => offscreen,
    isBrowserWorkspaceRendered: context => Boolean(window && !window.isDestroyed() && (!context || context === workspace.context || context === FLOATING_TERMINAL_WORKTREE_ID)),
    markHeadlessBrowserSessionTabActive: (context, page) => {
      const owner = context ?? workspace.owner(page) ?? workspace.context
      const session = workspace.session(owner)
      const saved = findSavedBrowserPage(session, owner, page)
      workspace.save(owner, { ...session, activeBrowserTabIdByWorktree: { ...session.activeBrowserTabIdByWorktree, [owner]: saved?.tabId ?? page } })
    },
    notifyHeadlessBrowserSessionTabsChanged: (context) => emit({ method: 'browser.tabsChanged', params: { context } }),
    readBrowserPageAnnotations: page => workspace.annotations(page),
    serveBrowserTabs: serveTabs,
    readBrowserTabBar: context => (context ? [context] : workspace.contexts()).flatMap(owner => (workspace.session(owner).browserTabsByWorktree?.[owner] ?? []).flatMap(tab => {
      const pageId = tab.activePageId ?? tab.pageIds?.[0]
      const page = pageId ? findSavedBrowserPage(workspace.session(owner), owner, pageId)?.page : undefined
      return page ? [{ browserPageId: page.id, worktreeId: owner, title: page.title, url: page.url, loadError: null, certificateFailure: null }] : []
    })),
    retireRuntimeOwnedBrowserSessionTab: (context, page) => serveTabs.closed(context, page)
  }
  const commands = new RuntimeBrowserCommands(host)
  const methods = new Map([...BROWSER_CORE_METHODS, ...BROWSER_EXTRA_METHODS, ...BROWSER_IDENTITY_METHODS, ...BROWSER_CLIENT_HOST_METHODS, ...BROWSER_SCREENCAST_METHODS, ...BROWSER_CLIENT_FILE_CHANNEL_METHODS].map(method => [method.name, method]))
  installElectronBrowserCommands()
  initializeBrowserExtensionSupport({ enabled: store.getSettings().browserExtensionsEnabled !== false, savedBrowserTabs: workspace })
  initializeBrowserSessionsForApp({ orcaProfileId: 'local', profileDirectory: options.dataDirectory })
  await setMainUiLanguage(store.getSettings().uiLanguage)
  browserSessionRegistry.onProfilesChanged = () => { window?.webContents.send('browser:session:profilesChanged'); emit({ method: 'browser.profilesChanged', params: {} }) }
  installDocPreviewProtocolHandler()
  registerDocPreviewGrantHandlers()
  setAgentBrowserBridgeRef(bridge)
  registerBrowserHandlers(store)
  const files = new BrowserWorkspaceFiles(context => {
    const selector = context.replace(/^(?:id:|cwd:)/, '')
    const root = isAbsolute(selector) ? selector : join(options.dataDirectory, 'workspaces', encodeURIComponent(selector))
    mkdirSync(root, { recursive: true, mode: 0o700 })
    return root
  })
  const callerRuntime = Object.assign(Object.create(commands), host, {
    getStartedAt: () => startedAt,
    resolveRuntimeFileTarget: async () => ({ executionHostId: 'local' }),
    readFileExplorerChunk: files.readFileExplorerChunk.bind(files),
    writeFileExplorerFileBase64Chunk: files.writeFileExplorerFileBase64Chunk.bind(files),
    commitFileExplorerUpload: files.commitFileExplorerUpload.bind(files),
    deleteFileExplorerPath: files.deleteFileExplorerPath.bind(files),
    createFileExplorerDir: files.createFileExplorerDir.bind(files),
    statRuntimeFile: files.statRuntimeFile.bind(files),
    registerSubscriptionCleanup: (id: string, cleanup: () => void, connectionId = 'javis-controller') => subscriptions.set(id, { cleanup, connectionId }),
    cleanupSubscription: (id: string) => { subscriptions.get(id)?.cleanup(); subscriptions.delete(id) },
    notifyMobileSessionTabsChanged: (context: string) => { rows.publish(context); emit({ method: 'browser.tabsChanged', params: { context } }) },
    resolveBrowserExecutionHostKeyForWorkspace: async () => ({ status: 'resolved', executionHostKey: browserNetworkExecutionHostKey({ kind: 'native', runtimeId, revision: startedAt }) }),
    markClientHostedPagesReconciled: (id: string) => emit({ method: 'browser.clientHost.reconciled', params: { pairedDeviceId: id } }),
    browserScreencast: (params: Parameters<RuntimeBrowserCommands['browserScreencast']>[0], stream: Parameters<RuntimeBrowserScreencastController['start']>[1]) => screencasts.start(params, stream)
  })
  const drivers = new RuntimeBrowserDriverController({
    notifyChanged: (page, driver) => { window?.webContents.send('runtime:browserDriverChanged', { browserPageId: page, driver }); emit({ method: 'browser.driverChanged', params: { browserPageId: page, driver } }) },
    cancelScreencast: page => screencasts.cancelMobilePage(page, true)
  })
  const screencasts = new RuntimeBrowserScreencastController({
    getCommands: () => commands,
    registerSubscriptionCleanup: (id, cleanup, connectionId = 'javis-controller') => subscriptions.set(id, { cleanup, connectionId }),
    cleanupSubscription: id => { subscriptions.get(id)?.cleanup(); subscriptions.delete(id) },
    getDriver: page => drivers.get(page),
    setDriver: (page, driver) => drivers.set(page, driver),
    notifyRemoteViewersChanged: (page, hasRemoteViewers) => { window?.webContents.send('runtime:browserRemoteViewersChanged', { browserPageId: page, hasRemoteViewers }); emit({ method: 'browser.remoteViewersChanged', params: { browserPageId: page, hasRemoteViewers } }) }
  })
  const rows = new ClientHostedBrowserRowPublisher({
    listClientPages: context => pages.listPages(context),
    hasLivePlacement: page => leases.getPlacement(page) !== undefined,
    resolveDeviceName: () => null,
    getEmitter: () => window ? event => window!.webContents.send('runtime:clientHostedBrowserRowsChanged', event) : null
  })
  const keybindings = new KeybindingService({ homePath: options.dataDirectory })
  const call: BrowserCall = async (method, params) => {
    if (method === '__shutdown') { await shutdown(); return { stopped: true } }
    if (method === 'browser.stream.delivery') return { accepted: delivery.acknowledge(params as any) }
    if (method === 'browser.stream.flow') { delivery.flow(String(params.connectionId), params.backlogged === true); return { updated: true } }
    if (method === 'browser.driver.get') return { driver: drivers.get(String(params.page)), remoteViewerPages: screencasts.getRemoteViewerPages() }
    if (method === 'browser.connection.close') {
      const id = String(params.connectionId)
      connections.get(id)?.abort()
      connections.delete(id)
      delivery.close(id)
      for (const [key, entry] of subscriptions) if (entry.connectionId === id) { entry.cleanup(); subscriptions.delete(key) }
      return { closed: true }
    }
    if (method === 'browser.host.call') {
      if (!['files.readChunk', 'files.writeBase64Chunk', 'files.commitUpload'].includes(String(params.method))) throw new BrowserError('invalid_argument', 'Unknown browser file method')
      return hostBridge.call(String(params.target), String(params.method), params.params)
    }
    if (method === 'browser.host.configure') { hostBridge.configure(params.routes as Record<string, string>); return { configured: true } }
    if (method === 'browser.host.admit') {
      const request = BrowserNetworkTunnelAttachParams.parse(params.params)
      if (request.authorityRuntimeId !== runtimeId) throw new BrowserError('invalid_argument', 'Browser network authority mismatch')
      const identity = { authorityEpoch: request.authorityEpoch, browserHostClientId: request.browserHostClientId, browserHostGeneration: request.browserHostGeneration, pairedDeviceId: String((params.__javisCaller as any)?.pairedDeviceId ?? 'javis-controller'), executionHostKey: browserNetworkExecutionHostKey(request.executionHost) }
      leases.requireLease(identity)
      if (request.executionHost.kind !== 'native') leases.requireExecutionHost(identity, identity.executionHostKey)
      else if (request.executionHost.runtimeId !== runtimeId || request.executionHost.revision !== startedAt) throw new BrowserError('invalid_argument', 'Browser network execution host is stale')
      const id = String(params.id)
      const connectionId = String((params.__javisCaller as any)?.connectionId ?? 'javis-controller')
      const existing = subscriptions.get(`host-network:${id}`)
      if (existing && existing.connectionId !== connectionId) throw new BrowserError('invalid_argument', 'Browser tunnel belongs to another connection')
      existing?.cleanup()
      const handle = leases.openTunnel(identity, { requireExecutionHostGrant: request.executionHost.kind !== 'native' })
      subscriptions.set(`host-network:${id}`, { cleanup: handle.release, connectionId })
      void handle.whenFenced.then(reason => { if (subscriptions.get(`host-network:${id}`)?.cleanup === handle.release) subscriptions.delete(`host-network:${id}`); emit({ method: 'browser.host.revoked', params: { id, reason, __javisConnectionId: connectionId } }) })
      return { admitted: true, tunnelGeneration: handle.tunnelGeneration, _meta: { runtimeId } }
    }
    if (method === 'browser.host.release') { const key = `host-network:${params.id}`; subscriptions.get(key)?.cleanup(); subscriptions.delete(key); return { released: true } }
    if (method === 'browser.host.invokeReply') return { accepted: hostBridge.invocationReply(params as any) }
    if (method === 'browser.host.subscription') return { accepted: hostBridge.subscriptionReply(params as any) }
    if (method === 'browser.host.binary') return { accepted: hostBridge.binary(params as any) }
    if (method === 'browser.host.reply') return { accepted: hostBridge.reply(params) }
    if (method === 'browser.annotations.targets') return { context: params.context ?? workspace.context, targets: [{ id: 'context-queue', label: 'Context queue', kind: 'queue', available: true }], consumers: [] }
    if (method === 'browser.annotations.enqueue') { const result = annotations.enqueue(params); emit({ method: 'browser.annotations.changed', params: { context: params.context, delivery: annotations.get(result.id) } }); return result }
    if (method === 'browser.annotations.list') return annotations.list(typeof params.context === 'string' ? params.context : undefined, params.includeAcknowledged === true)
    if (method === 'browser.annotations.ack') { const result = annotations.acknowledge(String(params.id)); emit({ method: 'browser.annotations.acknowledged', params: { ...result, delivery: annotations.get(String(params.id)) } }); return result }
    if (method === 'browser.status') return { running: true, pid: process.pid, protocolVersion: 1, runtimeId, startedAt, authorityEpoch: leases.authorityEpoch, pages: bridge.tabList().tabs, visible: window?.isVisible() ?? false }
    if (method === 'browser.open') {
      const changed = typeof params.worktree === 'string' && workspace.select(params.worktree)
      // Renderer ownership replaces only the selected context's offscreen guests; their saved rows remain.
      for (const [page] of bridge.getRegisteredTabs(workspace.context)) if (offscreen.ownsTab(page)) await offscreen.closeTab(page)
      if (!window || window.isDestroyed()) {
        const directory = __dirname
        window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload: join(directory, '../preload/javis-browser.cjs'), webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
        rendererId = window.webContents.id
        trackBrowserExtensionMainWindow(window)
        installMainWindowWebviewSecurity(window)
        setTrustedBrowserRendererWebContentsId(window.webContents.id)
        watchBrowserMainWindowReadiness(window)
        window.on('closed', () => { window = null; setTrustedBrowserRendererWebContentsId(null) })
        await window.loadFile(join(directory, '../renderer/index.html'))
        window.webContents.send('javis:browser:event', { method: 'browser.contextChanged', params: { context: workspace.context, generation: workspace.generation } })
      }
      if (changed) emit({ method: 'browser.contextChanged', params: { context: workspace.context, generation: workspace.generation } })
      if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' && (params.__javisForeground === true || !options.background)) window.show()
      return { opened: true, background: options.background, context: workspace.context }
    }
    const definition = methods.get(method)
    if (!definition) throw new BrowserError('invalid_argument', `Unknown browser method: ${method}`)
    const parsed = definition.params ? definition.params.parse(params) : undefined
    const connectionId = String((params.__javisCaller as any)?.connectionId ?? 'javis-controller')
    let connection = connections.get(connectionId)
    if (!connection) { connection = new AbortController(); connections.set(connectionId, connection) }
    let subscriptionId: string | undefined
    const streamEmit = (event: any) => { if (typeof event.subscriptionId === 'string') { subscriptionId = event.subscriptionId; delivery.replace(connectionId, event.subscriptionId) }; emit({ method, params: { ...event, __javisConnectionId: connectionId } }) }
    const context = {
      runtime: callerRuntime, clientKind: (params.__javisCaller as any)?.clientKind ?? 'runtime', connectionId: (params.__javisCaller as any)?.connectionId ?? 'javis-controller', pairedDeviceId: (params.__javisCaller as any)?.pairedDeviceId ?? 'javis-controller',
      clientCapabilities: (params.__javisCaller as any)?.clientCapabilities ?? [BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY, BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY, BROWSER_CLIENT_HOST_REQUEST_CAPABILITY],
      signal: connection.signal,
      sendBinary: (bytes: Uint8Array, options?: { dropWhenBacklogged?: boolean }) => delivery.send(connectionId, subscriptionId, method, bytes, options?.dropWhenBacklogged === true)
    }
    const result = (definition as any).streaming ? await new Promise<any>((resolve, reject) => {
      let ready = false
      Promise.resolve(definition.handler(parsed, context, event => {
        streamEmit(event)
        if (event.type === 'ready') { ready = true; resolve(event) }
      })).then(value => { if (!ready) resolve(value) }, reject)
    }) : await definition.handler(parsed, context, streamEmit)
    if (method === 'browser.tabSetProfile' && result) workspace.setProfile(result.browserPageId, result.profileId)
    return result
  }
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!window || event.sender.id !== window.webContents.id) throw new BrowserError('invalid_argument', 'Untrusted browser workspace')
  }
  const trustedPersistence = (event: Electron.IpcMainInvokeEvent) => { if (stopping && event.sender.id === rendererId) return; trusted(event) }
  ipcMain.handle('javis:browser:call', (event, method, params) => { trusted(event); return call(method, params) })
  ipcMain.handle('javis:browser:bootstrap', (event) => { trusted(event); return { context: workspace.context, host: 'local', ui: workspace.ui, generation: workspace.generation, settings: store.getSettings(), session: workspace.session(), contexts: workspace.contexts().map(id => ({ id, root: isAbsolute(id.replace(/^cwd:/, '')) ? id.replace(/^cwd:/, '') : join(options.dataDirectory, 'workspaces', encodeURIComponent(id)), owner: { kind: 'local' } })), runtimeEnvironments: [] } })
  ipcMain.handle('javis:browser:persist-workspace', (event, input) => { trustedPersistence(event); workspace.replace(input); return true })
  ipcMain.handle('javis:browser:runtime-invoke', (event, args) => { trusted(event); if (!String(args.method).startsWith('browser.')) throw new BrowserError('invalid_argument', 'Unknown browser runtime method'); return hostBridge.call(args.selector, args.method, args.params) })
  ipcMain.handle('javis:browser:subscribe', async (event, args) => {
    trusted(event)
    if (args.method !== 'browser.screencast') throw new BrowserError('invalid_argument', 'Unknown browser subscription')
    const forward = (message: Record<string, unknown>) => event.sender.send('javis:browser:subscription', { subscriptionId: args.subscriptionId, ...message })
    const handle = await hostBridge.subscribe(args.selector, args.method, args.params, {
      onResponse: response => forward({ type: 'response', response }),
      onPacket: packet => forward({ type: 'binary', packet }),
      onError: error => forward({ type: 'error', code: error.code, message: error.message }),
      onClose: () => forward({ type: 'close' })
    }, { javisCaller: { connectionId: `renderer:${event.sender.id}:${args.subscriptionId}`, pairedDeviceId: 'javis-controller', clientKind: 'runtime' } })
    uiSubscriptions.set(args.subscriptionId, handle)
    return { id: handle.requestId }
  })
  ipcMain.handle('javis:browser:unsubscribe', (event, id) => { trusted(event); uiSubscriptions.get(id)?.close(); uiSubscriptions.delete(id); return true })
  ipcMain.handle('javis:browser:subscription-request', (event, args) => { trusted(event); const handle = uiSubscriptions.get(args.id); if (!handle?.sendRequest) throw new Error('browser_subscription_closed'); return handle.sendRequest(args.method, args.params, 15000).then(response => { if (args.method === 'browser.screencast.ack') hostBridge.flow({ id: handle.requestId, backlogged: false }); return response }) })
  ipcMain.on('javis:browser:subscription-delivery', (event, args) => { if (window && event.sender.id === window.webContents.id) { hostBridge.delivery(args); if (args.outcome !== 'backlogged') hostBridge.flow({ id: args.id, backlogged: false }) } })
  ipcMain.handle('settings:get', (event) => { trusted(event); return store.getSettings() })
  ipcMain.handle('settings:set', (event, patch) => { trusted(event); store.updateSettings(patch); if ('uiLanguage' in patch) void setMainUiLanguage(patch.uiLanguage); if ('browserExtensionsEnabled' in patch) void switchBrowserExtensionSupport(patch.browserExtensionsEnabled !== false); window?.webContents.send('settings:changed', patch); return store.getSettings() })
  ipcMain.on('settings:get-sync', (event) => { if (window && event.sender.id === window.webContents.id) event.returnValue = store.getSettings() })
  ipcMain.handle('ui:get', event => { trusted(event); return workspace.ui })
  ipcMain.handle('ui:set', (event, patch) => { trusted(event); workspace.updateUI(patch); window?.webContents.send('ui:stateChanged', workspace.ui); return workspace.ui })
  ipcMain.handle('app:get-locale', event => { trusted(event); return app.getLocale() })
  ipcMain.handle('app:get-version', event => { trusted(event); return app.getVersion() })
  ipcMain.handle('clipboard:writeText', (event, text) => { trusted(event); clipboard.writeText(text); return true })
  ipcMain.handle('app:await-before-unload-checkpoint', event => { trustedPersistence(event); workspace.save(workspace.context, workspace.session()); return { ok: true } })
  ipcMain.handle('shell:openUrl', (event, url) => { trusted(event); const target = normalizeExternalBrowserUrl(url); if (!target) throw new BrowserError('invalid_argument', 'Invalid external URL'); return shell.openExternal(target) })
  ipcMain.handle('ui:recordFeatureInteraction', (event, id) => { trusted(event); workspace.updateUI({ featureInteractions: { ...(workspace.ui.featureInteractions ?? {}), [id]: Date.now() } }); return true })
  ipcMain.handle('runtime:getBrowserDrivers', event => { trusted(event); return [...drivers.getAll()].map(([browserPageId, driver]) => ({ browserPageId, driver })) })
  ipcMain.handle('runtime:getBrowserRemoteViewerPages', event => { trusted(event); return screencasts.getRemoteViewerPages() })
  ipcMain.handle('runtime:getClientHostedBrowserRows', event => { trusted(event); return rows.deliverHydrationSnapshot() })
  ipcMain.handle('runtime:reclaimBrowserForDesktop', (event, { browserPageId }) => { trusted(event); return { reclaimed: drivers.reclaimForDesktop(browserPageId) } })
  ipcMain.handle('keybindings:get', event => { trusted(event); return keybindings.getSnapshot() })
  ipcMain.handle('keybindings:ensureFile', event => { trusted(event); const snapshot = keybindings.ensureFile(); window?.webContents.send('keybindings:changed', snapshot); return snapshot })
  ipcMain.handle('keybindings:setAction', (event, args) => { trusted(event); const snapshot = keybindings.setActionBindings(args.actionId, args.bindings); window?.webContents.send('keybindings:changed', snapshot); return snapshot })
  ipcMain.handle('keybindings:openFile', async event => { trusted(event); const snapshot = keybindings.ensureFile(); const error = await shell.openPath(snapshot.path); if (error) throw new Error(error); return snapshot })
  ipcMain.handle('keybindings:revealFile', event => { trusted(event); const snapshot = keybindings.ensureFile(); shell.showItemInFolder(snapshot.path); return snapshot })
  ipcMain.handle('keybindings:reload', event => { trusted(event); const snapshot = keybindings.reload(); window?.webContents.send('keybindings:changed', snapshot); return snapshot })
  ipcMain.on('app:stage-before-unload-sync', (event, input) => {
    try { trustedPersistence(event as Electron.IpcMainInvokeEvent); if (input.args.sessions?.[0]) workspace.replace({ ...input.workspace, session: input.args.sessions[0].state }); if (input.workspace.context === workspace.context) workspace.updateUI(input.args.ui ?? {}); event.returnValue = { ok: true } } catch (error) { event.returnValue = { ok: false, error: (error as Error).message } }
  })
  let stopping: Promise<void> | null = null
  function shutdown(): Promise<void> {
    return stopping ??= (async () => {
      lifetime.abort()
      for (const entry of subscriptions.values()) entry.cleanup()
      for (const connection of connections.values()) connection.abort()
      connections.clear()
      subscriptions.clear()
      for (const handle of uiSubscriptions.values()) handle.close()
      uiSubscriptions.clear()
      hostBridge.close()
      await offscreen.destroyAll()
      await bridge.destroyAllSessions()
      if (window && !window.isDestroyed()) window.destroy()
      setAgentBrowserBridgeRef(null)
    })()
  }
  return { call, shutdown }
}
