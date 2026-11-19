import { contextBridge, ipcRenderer } from 'electron'
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
contextBridge.exposeInMainWorld('api', {
  browser: browserApi,
  ui: uiApi,
  app: { getLocale: () => ipcRenderer.invoke('app:get-locale'), getVersion: () => ipcRenderer.invoke('app:get-version') },
  browserPasswords: browserPasswordsApi,
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    getSync: () => ipcRenderer.sendSync('settings:get-sync'),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
    onChanged: (callback: (patch: Record<string, unknown>) => void) => on('settings:changed', callback)
  },
  runtime: {
    call: (method: string, params: Record<string, unknown>) => call(method, params),
    invoke: (method: string, params: Record<string, unknown>) => call(method, params),
    onEvent: (callback: (event: unknown) => void) => on('javis:browser:event', callback)
  },
  javisBrowser: {
    bootstrap: () => ipcRenderer.invoke('javis:browser:bootstrap'),
    persistWorkspace: (session: unknown) => ipcRenderer.invoke('javis:browser:persist-workspace', session),
    call,
    onEvent: (callback: (event: unknown) => void) => on('javis:browser:event', callback)
  }
})
installBrowserFindListener()
