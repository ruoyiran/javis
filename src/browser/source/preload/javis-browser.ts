import { contextBridge, ipcRenderer } from 'electron'
import { keybindingsApi } from './api/keybindings-bridge'
import { docPreviewApi } from './api/doc-preview-bridge'
import { shellApi } from './api/shell-bridge'
import { uiApi } from './api/ui-bridge'
import { browserApi } from './api/browser/browser-bridge'
import { browserPasswordsApi } from './api/browser-passwords-bridge'
import { installBrowserFindListener } from './preload-runtime-support'

const on = (channel: string, callback: (...args: any[]) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const call = (method: string, params: Record<string, unknown> = {}) => ipcRenderer.invoke('javis:browser:call', method, params)
let workspace: { context: string; generation: number } | null = null
type SubscriptionCallbacks = { onResponse(response: unknown): void; onBinary?(bytes: Uint8Array): unknown; onError?(error: { code: string; message: string }): void; onClose?(): void }
const subscriptions = new Map<string, SubscriptionCallbacks>()
ipcRenderer.on('javis:browser:subscription', (_event, message) => {
  const callbacks = subscriptions.get(message.subscriptionId)
  if (!callbacks) return
  if (message.type === 'response') callbacks.onResponse(message.response)
  if (message.type === 'error') callbacks.onError?.({ code: message.code, message: message.message })
  if (message.type === 'close') { subscriptions.delete(message.subscriptionId); callbacks.onClose?.() }
  if (message.type === 'binary') {
    const packet = message.packet
    let outcome: boolean | 'backlogged' = false
    try { const result = callbacks.onBinary?.(new Uint8Array(Buffer.from(packet.bytes, 'base64'))); outcome = result === 'backlogged' ? 'backlogged' : result !== false } catch (error) { callbacks.onError?.({ code: 'browser_stream_error', message: (error as Error).message }) }
    if (packet.packetId) ipcRenderer.send('javis:browser:subscription-delivery', { id: packet.id, packetId: packet.packetId, outcome, backlogged: outcome === 'backlogged' })
  }
})
const runtimeEnvironments = {
  prepareBrowserClientHostPlacement: (args: unknown) => ipcRenderer.invoke('javis:browser:prepare-client-host', args),
  refresh: () => call('browser.catalog.refresh'),
  onCatalogChanged: (callback:()=>void) => on('javis:browser:event',event=>{if(event.method==='browser.runtimeCatalogChanged')callback()}),
  list: async () => (await ipcRenderer.invoke('javis:browser:bootstrap')).runtimeEnvironments,
  invoke: (args: { selector: string; method: string; params?: unknown }) => ipcRenderer.invoke('javis:browser:runtime-invoke', args),
  call: (args: { selector: string; method: string; params?: unknown; expectedEnvironmentPairingRevision?: number; timeoutMs?: number }) => ipcRenderer.invoke('javis:browser:runtime-invoke', { ...args, method: args.method === 'session.tabs.list' ? 'browser.workspaceSnapshot' : args.method }),
  subscribe: async (args: { subscriptionId?: string; selector: string; method: string; params?: unknown }, callbacks: SubscriptionCallbacks) => {
    const id = args.subscriptionId ?? crypto.randomUUID()
    subscriptions.set(id, callbacks)
    try { await ipcRenderer.invoke('javis:browser:subscribe', { ...args, subscriptionId: id }) } catch (error) { subscriptions.delete(id); throw error }
    return { unsubscribe: () => { subscriptions.delete(id); void ipcRenderer.invoke('javis:browser:unsubscribe', id) }, sendBinary: (_bytes: Uint8Array) => { throw new Error('Browser screencast does not accept input on its frame channel') }, sendRequest: (method: string, params: unknown) => ipcRenderer.invoke('javis:browser:subscription-request', { id, method, params }) }
  }
}
contextBridge.exposeInMainWorld('api', {
  fs: {stat:(args:unknown)=>ipcRenderer.invoke('javis:browser:fs-stat',args),readFile:(args:unknown)=>ipcRenderer.invoke('javis:browser:fs-read',args)},
  runtimeEnvironments,
  keybindings: keybindingsApi,
  browser: browserApi,
  docPreview: docPreviewApi,
  shell: shellApi,
  ui: uiApi,
  app: { getLocale: () => ipcRenderer.invoke('app:get-locale'), getVersion: () => ipcRenderer.invoke('app:get-version'), stageBeforeUnloadSync: (args: unknown) => { const result = ipcRenderer.sendSync('app:stage-before-unload-sync', { workspace, args }); if (!result?.ok) throw new Error(result?.error ?? 'Browser checkpoint failed') }, awaitBeforeUnloadCheckpoint: () => ipcRenderer.invoke('app:await-before-unload-checkpoint') },
  browserPasswords: browserPasswordsApi,
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    getSync: () => ipcRenderer.sendSync('settings:get-sync'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
    onChanged: (callback: (patch: Record<string, unknown>) => void) => on('settings:changed', callback)
  },
  runtime: {
    getBrowserDrivers: () => ipcRenderer.invoke('runtime:getBrowserDrivers'),
    getBrowserRemoteViewerPages: () => ipcRenderer.invoke('runtime:getBrowserRemoteViewerPages'),
    getClientHostedBrowserRows: () => ipcRenderer.invoke('runtime:getClientHostedBrowserRows'),
    reclaimBrowserForDesktop: (browserPageId: string) => ipcRenderer.invoke('runtime:reclaimBrowserForDesktop', { browserPageId }),
    onBrowserDriverChanged: (callback: (event: unknown) => void) => on('runtime:browserDriverChanged', callback),
    onBrowserRemoteViewersChanged: (callback: (event: unknown) => void) => on('runtime:browserRemoteViewersChanged', callback),
    onClientHostedBrowserRowsChanged: (callback: (event: unknown) => void) => on('runtime:clientHostedBrowserRowsChanged', callback),
    call: (method: string, params: Record<string, unknown>) => call(method, params),
    invoke: (method: string, params: Record<string, unknown>) => call(method, params),
    onEvent: (callback: (event: unknown) => void) => on('javis:browser:event', callback)
  },
  javisBrowser: {
    bootstrap: async () => { const result = await ipcRenderer.invoke('javis:browser:bootstrap'); workspace = { context: result.context, generation: result.generation }; return result },
    persistWorkspace: (session: unknown) => ipcRenderer.invoke('javis:browser:persist-workspace', { ...workspace, session }),
    call,
    onEvent: (callback: (event: unknown) => void) => on('javis:browser:event', callback)
  }
})
installBrowserFindListener()
