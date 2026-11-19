import { BROWSER_EXTENSION_API_CUSTOM_SCHEME } from '../source/main/browser/extensions/api-runtime/browser-extension-api-scheme'
import { app, protocol } from 'electron'
import { connect } from 'node:net'
import { mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { initializeBrowserIdentityModeStore } from '../source/main/browser/identity/mode/browser-identity-mode-store'
import { initializeBrowserProcessUserAgent } from '../source/main/browser/identity/browser-process-user-agent'
import { setAppEnvironment } from '../source/shared/app-environment'
import { ElectronAppEnvironment } from '../source/main/host/electron-app-environment'

async function main(): Promise<void> {
const channel = process.env.JAVIS_BROWSER_CHANNEL
const token = process.env.JAVIS_BROWSER_TOKEN
const directory = process.env.JAVIS_BROWSER_DATA_DIRECTORY
if (!channel || !token || !directory) throw new Error('Browser controller credentials are missing')
mkdirSync(directory, { recursive: true, mode: 0o700 })
app.setPath('userData', directory)
app.setName('Javis Browser')
setAppEnvironment(new ElectronAppEnvironment())
const identity = initializeBrowserIdentityModeStore(directory)
initializeBrowserProcessUserAgent(identity.appliedMode)
protocol.registerSchemesAsPrivileged([BROWSER_EXTENSION_API_CUSTOM_SCHEME, { scheme: 'orca-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const background = process.env.JAVIS_BROWSER_BACKGROUND === '1' || process.env.ORCA_BACKGROUND_LAUNCH === '1'
if (background && process.platform === 'darwin') app.setActivationPolicy('accessory')
app.on('window-all-closed', () => {})
await app.whenReady()
const socket = connect(channel)
await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
const send = (value: unknown) => socket.write(`${JSON.stringify(value)}\n`)
const { createBrowserService } = await import('./browser-service')
const service = await createBrowserService({ dataDirectory: directory, background, emit: event => send({ kind: 'event', ...event }) })
send({ kind: 'ready', token, pid: process.pid, protocolVersion: 1 })
const lines = createInterface({ input: socket, crlfDelay: Infinity })
lines.on('line', line => {
  let request: any
  try { request = JSON.parse(line) } catch { socket.destroy(); return }
  if (request.kind !== 'request' || typeof request.method !== 'string' || !request.id) { socket.destroy(); return }
  void service.call(request.method, request.params ?? {}).then(result => {
    send({ kind: 'response', id: request.id, ok: true, result })
    if (request.method === '__shutdown') { socket.end(); app.exit(0) }
  }, error => send({ kind: 'response', id: request.id, ok: false, error: { code: error.code ?? 'browser_error', message: error.message ?? String(error), ...(error.data ? { data: error.data } : {}) } }))
})
socket.on('close', () => void service.shutdown().finally(() => app.exit(0)))

}
void main().catch(error => { console.error(error.message); app.exit(1) })
