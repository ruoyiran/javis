import { access, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { JavisError } from '../../runtime/error.js'
import { JAVIS_VERSION } from '../../version.js'
import { setAppEnvironment } from '../source/shared/app-environment.js'
import { ExternalChromiumBrowserProcess } from '../source/main/orcad/external-chromium-browser-process.js'
import { BROWSER_CORE_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-core.js'
import { BROWSER_EXTRA_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-extras.js'
import { BROWSER_IDENTITY_METHODS } from '../source/main/runtime/rpc/methods/browser/browser-identity-rpc.js'
import { initializeBrowserIdentityModeStore } from '../source/main/browser/identity/mode/browser-identity-mode-store.js'
import type { RuntimeBrowserCommandHost } from '../source/main/runtime/browser/commands/browser-command-contracts.js'
import type { BrowserEvent } from './browser-channel.js'

export type ExternalBrowserProvider = { call(method: string, params: Record<string, unknown>): Promise<unknown>; shutdown(): Promise<void> }

export async function createExternalBrowserProvider(options: {
  executable: string
  dataDirectory: string
  cliEntry: string
  emit(event: BrowserEvent): void
}): Promise<ExternalBrowserProvider> {
  try { await access(options.executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK) }
  catch { throw new JavisError('browser_executable_missing', 'The configured Chromium executable is unavailable') }
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 })
  setAppEnvironment({
    getPath: name => name === 'userData' ? options.dataDirectory : name === 'exe' ? process.execPath : name === 'temp' ? tmpdir() : name === 'downloads' ? join(homedir(), 'Downloads') : name === 'logs' ? join(options.dataDirectory, 'logs') : homedir(),
    getAppPath: () => dirname(options.cliEntry), getVersion: () => JAVIS_VERSION,
    isPackaged: () => false, getCliLauncherPath: () => options.cliEntry,
    onWillQuit: handler => process.once('SIGTERM', handler), exit: code => process.exit(code), getAppMetrics: () => []
  })
  const require = createRequire(options.cliEntry)
  const name = `agent-browser-${process.platform}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`
  const packagedResources = process.platform === 'darwin'
    ? ['browser/Javis Browser.app/Contents/Resources', 'browser/electron/Electron.app/Contents/Resources']
    : ['browser/electron/resources']
  let binary: string | undefined
  for (const resources of packagedResources) {
    const candidate = join(dirname(options.cliEntry), resources, name)
    try { await access(candidate); binary = candidate; break } catch {}
  }
  if (!binary) {
    try { binary = join(dirname(require.resolve('agent-browser/package.json')), 'bin', name); await access(binary) }
    catch { throw new JavisError('browser_driver_missing', 'The matching browser automation driver is unavailable') }
  }
  initializeBrowserIdentityModeStore(options.dataDirectory)
  const processHandle = new ExternalChromiumBrowserProcess(binary, { executablePath: options.executable, provider: 'chromium' }, options.dataDirectory)
  await processHandle.start()
  const runtimeId = randomUUID()
  const host = {
    getRuntimeId: () => runtimeId,
    resolveBrowserWorkspace: async (selector: string) => ({ id: selector.replace(/^id:/, '') }),
    markHeadlessBrowserSessionTabActive: (worktreeId: string, browserPageId: string) => options.emit({ method: 'browser.activePage', params: { worktreeId, browserPageId } }),
    notifyHeadlessBrowserSessionTabsChanged: (worktreeId: string) => options.emit({ method: 'browser.tabsChanged', params: { worktreeId } })
  } as unknown as RuntimeBrowserCommandHost
  const runtime = processHandle.createCommands(host)
  const methods = new Map([...BROWSER_CORE_METHODS, ...BROWSER_EXTRA_METHODS, ...BROWSER_IDENTITY_METHODS].map(method => [method.name, method]))
  return {
    async call(method, params) {
      if (method === 'browser.status') return { running: processHandle.isAvailable(), provider: 'chromium', runtimeId, visible: false }
      if (method === '__shutdown') { await processHandle.stop(); return { stopped: true } }
      if (method === 'browser.open') throw new JavisError('browser_host_unavailable', 'The external Chromium provider has no desktop browser workspace')
      const definition = methods.get(method)
      if (!definition) throw new JavisError('browser_unavailable', 'This operation requires the desktop Electron browser provider')
      return definition.handler(definition.params ? definition.params.parse(params) : undefined, { runtime })
    },
    shutdown: () => processHandle.stop()
  }
}
