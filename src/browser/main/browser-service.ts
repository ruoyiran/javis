import { installMainWindowWebviewSecurity } from '../source/main/window/main-window-webview-security'
import { BROWSER_IDENTITY_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-identity-rpc'
import { initializeBrowserIdentityModeStore } from '../source/main/browser/identity/mode/browser-identity-mode-store'
import { BrowserHostBridge } from './host-bridge'
import { setBrowserHostTransport } from '../source/main/ipc/runtime-environments/runtime-environment-transport-routing'
import { initializeBrowserExtensionSupport, switchBrowserExtensionSupport } from '../source/main/browser/extensions/browser-extension-startup'
import { BROWSER_CLIENT_HOST_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-client-host'
import { BROWSER_SCREENCAST_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-screencast'
import { browserNetworkExecutionHostKey } from '../source/shared/browser/client-hosting/browser-network-execution-host'
import { AnnotationQueue } from './annotation-queue'
import { getDefaultWorkspaceSession, getDefaultUIState } from '../source/shared/constants'
import { app, BrowserWindow, ipcMain, clipboard } from 'electron'
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
  const emit = (event: { method: string; params: Record<string, unknown> }) => { options.emit(event); if (window && !window.isDestroyed()) window.webContents.send('javis:browser:event', event) }
  const statePath = join(options.dataDirectory, 'workspace.json')
  let state: Record<string, any> = { context: 'default', session: getDefaultWorkspaceSession(), ui: getDefaultUIState() }
  try { state = JSON.parse(readFileSync(statePath, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  state.sessions ??= { [state.context]: state.session }
  const selectContext = (context: string) => {
    state.sessions[state.context] = state.session
    state.context = context
    state.session = state.sessions[context] ?? getDefaultWorkspaceSession()
    state.sessions[context] = state.session
  }
  const persist = () => {
    state.sessions[state.context] = state.session
    writeFileSync(`${statePath}.tmp`, JSON.stringify(state), { mode: 0o600 })
    renameSync(`${statePath}.tmp`, statePath)
  }
  const store = new Store()
  const hostBridge = new BrowserHostBridge(emit)
  setBrowserHostTransport((target, method, params, timeout) => hostBridge.call(target, method, params, timeout))
  const annotations = new AnnotationQueue(join(options.dataDirectory, 'annotation-deliveries.json'))
  const runtimeId = randomUUID()
  const startedAt = Date.now()
  const subscriptions = new Map<string, () => void>()
  const lifetime = new AbortController()
  const leases = new BrowserHostLeaseRegistry({ authorityRuntimeId: runtimeId })
  const requests = new BrowserHostRequestRegistry()
  const pages = new RuntimeBrowserPageRegistry()
  const bridge = new AgentBrowserBridge(browserManager)
  const offscreen = new OffscreenBrowserBackend(browserManager, {
    getAgentBrowserBridge: () => bridge,
    onPageNavigated: (page) => {
      state.pages ??= {}
      state.pages[page.pageId] = { ...state.pages[page.pageId], ...page }
      persist()
      emit({ method: 'browser.pageNavigated', params: page })
    }
  })
  const host: RuntimeBrowserCommandHost = {
    getRuntimeId: () => runtimeId,
    getAgentBrowserBridge: () => bridge,
    resolveWorkspaceSelector: async (selector) => ({ id: selector.replace(/^id:/, ''), hostId: 'local' }),
    resolveBrowserWorkspace: async (selector) => ({ id: selector.replace(/^id:/, ''), hostId: 'local' }),
    resolveBrowserNetworkExecutionHost: () => ({ kind: 'native', runtimeId, revision: startedAt }),
    getBrowserHostLeaseRegistry: () => leases,
    getBrowserHostRequestRegistry: () => requests,
    getRuntimeBrowserPageRegistry: () => pages,
    getAuthoritativeWindow: () => { if (!window || window.isDestroyed()) throw new BrowserError('browser_host_unavailable', 'Browser workspace is closed'); return window },
    getAvailableAuthoritativeWindow: () => window && !window.isDestroyed() ? window : null,
    getOffscreenBrowserBackend: () => offscreen,
    markHeadlessBrowserSessionTabActive: (context, page) => {
      state.activePages ??= {}
      state.activePages[context ?? 'default'] = page
      persist()
    },
    notifyHeadlessBrowserSessionTabsChanged: (context) => emit({ method: 'browser.tabsChanged', params: { context } }),
    readBrowserPageAnnotations: (page) => state.session.browserAnnotationsByPage?.[page] ?? state.session.browserPageAnnotations?.[page] ?? [],
    retireRuntimeOwnedBrowserSessionTab: (_context, page) => { if (!state.pages?.[page]) return false; delete state.pages[page]; persist(); return true }
  }
  const commands = new RuntimeBrowserCommands(host)
  const methods = new Map([...BROWSER_CORE_METHODS, ...BROWSER_EXTRA_METHODS, ...BROWSER_IDENTITY_METHODS, ...BROWSER_CLIENT_HOST_METHODS, ...BROWSER_SCREENCAST_METHODS, ...BROWSER_CLIENT_FILE_CHANNEL_METHODS].map(method => [method.name, method]))
  initializeBrowserIdentityModeStore(options.dataDirectory)
  installElectronBrowserCommands()
  initializeBrowserExtensionSupport({ enabled: store.getSettings().browserExtensionsEnabled !== false })
  browserSessionRegistry.initializeBrowserSessionsFromPersistedState()
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
    registerSubscriptionCleanup: (id: string, cleanup: () => void) => subscriptions.set(id, cleanup),
    cleanupSubscription: (id: string) => { subscriptions.get(id)?.(); subscriptions.delete(id) },
    notifyMobileSessionTabsChanged: (context: string) => emit({ method: 'browser.tabsChanged', params: { context } }),
    resolveBrowserExecutionHostKeyForWorkspace: async () => ({ status: 'resolved', executionHostKey: browserNetworkExecutionHostKey({ kind: 'native', runtimeId, revision: startedAt }) }),
    markClientHostedPagesReconciled: (id: string) => { state.reconciledClients ??= {}; state.reconciledClients[id] = startedAt; persist() },
    browserScreencast: async (params: any, stream: any) => {
      const started = await commands.browserScreencast(params, stream)
      subscriptions.set(started.subscriptionId, started.session.stop)
      stream.emit(started.ready)
      started.flushPendingFrame()
      return { subscriptionId: started.subscriptionId }
    }
  })
  const call: BrowserCall = async (method, params) => {
    if (method === '__shutdown') { await shutdown(); return { stopped: true } }
    if (method === 'browser.host.reply') return { accepted: hostBridge.reply(params) }
    if (method === 'browser.annotations.enqueue') return annotations.enqueue(params)
    if (method === 'browser.annotations.list') return annotations.list(typeof params.context === 'string' ? params.context : undefined)
    if (method === 'browser.annotations.ack') return annotations.acknowledge(String(params.id))
    if (method === 'browser.status') return { running: true, pid: process.pid, protocolVersion: 1, runtimeId, startedAt, authorityEpoch: leases.authorityEpoch, pages: bridge.tabList().tabs, visible: window?.isVisible() ?? false }
    if (method === 'browser.open') {
      if (typeof params.worktree === 'string') { selectContext(params.worktree); persist() }
      if (!window || window.isDestroyed()) {
        const directory = __dirname
        window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { preload: join(directory, '../preload/javis-browser.cjs'), webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false } })
        installMainWindowWebviewSecurity(window)
        setTrustedBrowserRendererWebContentsId(window.webContents.id)
        watchBrowserMainWindowReadiness(window)
        window.on('closed', () => { window = null; setTrustedBrowserRendererWebContentsId(null) })
        await window.loadFile(join(directory, '../renderer/index.html'))
        window.webContents.send('javis:browser:event', { method: 'browser.contextChanged', params: { context: state.context } })
      }
      if (process.env.ORCA_BACKGROUND_LAUNCH !== '1' && (params.__javisForeground === true || !options.background)) window.show()
      return { opened: true, background: options.background, context: state.context }
    }
    const definition = methods.get(method)
    if (!definition) throw new BrowserError('invalid_argument', `Unknown browser method: ${method}`)
    const parsed = definition.params ? definition.params.parse(params) : undefined
    const streamEmit = (event: any) => emit({ method, params: event })
    const context = {
      runtime: callerRuntime, clientKind: (params.__javisCaller as any)?.clientKind ?? 'runtime', connectionId: (params.__javisCaller as any)?.connectionId ?? 'javis-controller', pairedDeviceId: (params.__javisCaller as any)?.pairedDeviceId ?? 'javis-controller',
      clientCapabilities: (params.__javisCaller as any)?.clientCapabilities ?? [BROWSER_CLIENT_HOST_RUNTIME_CAPABILITY, BROWSER_CLIENT_PAGE_METADATA_RUNTIME_CAPABILITY, BROWSER_CLIENT_HOST_REQUEST_CAPABILITY],
      signal: lifetime.signal,
      sendBinary: (bytes: Uint8Array) => { emit({ method: 'browser.stream.binary', params: { method, bytes: Buffer.from(bytes).toString('base64') } }); return true }
    }
    const result = (definition as any).streaming ? await new Promise<any>((resolve, reject) => {
      let ready = false
      Promise.resolve(definition.handler(parsed, context, event => {
        streamEmit(event)
        if (event.type === 'ready') { ready = true; resolve(event) }
      })).then(value => { if (!ready) resolve(value) }, reject)
    }) : await definition.handler(parsed, context, streamEmit)
    if (method === 'browser.tabCreate' && result && typeof result === 'object' && 'browserPageId' in result) {
      state.pages ??= {}
      state.pages[String(result.browserPageId)] = { pageId: result.browserPageId, worktreeId: params.worktree ?? state.context, profileId: params.profileId, url: params.url ?? 'about:blank' }
      persist()
    }
    if (method === 'browser.tabClose' && params.page && state.pages) { delete state.pages[String(params.page)]; persist() }
    return result
  }
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (!window || event.sender.id !== window.webContents.id) throw new BrowserError('invalid_argument', 'Untrusted browser workspace')
  }
  ipcMain.handle('javis:browser:call', (event, method, params) => { trusted(event); return call(method, params) })
  ipcMain.handle('javis:browser:bootstrap', (event) => { trusted(event); return { context: state.context, host: 'local', ui: state.ui ?? getDefaultUIState(), settings: store.getSettings(), session: state.session, runtimeEnvironments: [] } })
  ipcMain.handle('javis:browser:persist-workspace', (event, session) => { trusted(event); state.session = session; persist(); return true })
  ipcMain.handle('settings:get', (event) => { trusted(event); return store.getSettings() })
  ipcMain.handle('settings:set', (event, patch) => { trusted(event); store.updateSettings(patch); if ('browserExtensionsEnabled' in patch) void switchBrowserExtensionSupport(patch.browserExtensionsEnabled !== false); window?.webContents.send('settings:changed', patch); return store.getSettings() })
  ipcMain.on('settings:get-sync', (event) => { if (window && event.sender.id === window.webContents.id) event.returnValue = store.getSettings() })
  ipcMain.handle('ui:get', event => { trusted(event); return state.ui ?? getDefaultUIState() })
  ipcMain.handle('ui:set', (event, patch) => { trusted(event); state.ui = { ...state.ui, ...patch }; persist(); window?.webContents.send('ui:stateChanged', state.ui); return state.ui })
  ipcMain.handle('app:get-locale', event => { trusted(event); return app.getLocale() })
  ipcMain.handle('app:get-version', event => { trusted(event); return app.getVersion() })
  ipcMain.handle('clipboard:writeText', (event, text) => { trusted(event); clipboard.writeText(text); return true })
  ipcMain.handle('app:await-before-unload-checkpoint', event => { trusted(event); persist(); return { ok: true } })
  let stopping: Promise<void> | null = null
  function shutdown(): Promise<void> {
    return stopping ??= (async () => {
      lifetime.abort()
      for (const cleanup of subscriptions.values()) cleanup()
      subscriptions.clear()
      hostBridge.close()
      await offscreen.destroyAll()
      await bridge.destroyAllSessions()
      if (window && !window.isDestroyed()) window.destroy()
      for (const channel of ['javis:browser:call', 'javis:browser:bootstrap', 'javis:browser:persist-workspace', 'settings:get', 'settings:set', 'ui:get', 'ui:set', 'app:get-locale', 'app:get-version', 'clipboard:writeText', 'app:await-before-unload-checkpoint']) ipcMain.removeHandler(channel)
      setAgentBrowserBridgeRef(null)
    })()
  }
  for (const saved of Object.values(state.pages ?? {}) as any[]) await offscreen.createTab({ url: saved.url, worktreeId: saved.worktreeId, profileId: saved.profileId, browserPageId: saved.pageId })
  return { call, shutdown }
}
