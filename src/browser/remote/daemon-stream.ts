import { BrowserHostNetworkSessions } from './network-session.js'
import { dispatchBrowserHostRequest } from './host-dispatch.js'
import type net from 'node:net'
import { randomUUID } from 'node:crypto'
import { browserMethods, validateBrowserParams } from '../contract/index.js'
import { callBrowser, subscribeBrowserEvents } from '../runtime/browser-process.js'
import { runtimeErrorDetails, JavisError } from '../../runtime/error.js'
import { BrowserFrameDecoder, writeBrowserFrame, type BrowserCallerIdentity } from './framed-channel.js'

const allowed = new Set<string>(browserMethods)

export function serveBrowserDaemonStream(socket: net.Socket, identity: BrowserCallerIdentity, token: string, onClose: () => void): void {
  const connectionId = randomUUID()
  const caller = { ...identity, connectionId }
  const decoder = new BrowserFrameDecoder()
  const requestIds = new Set<number>()
  const subscriptions = new Set<string>()
  let closed = false
  let activeRequests = 0
  const network = new BrowserHostNetworkSessions(event => { if (closed) return false; try { return writeBrowserFrame(socket, { type: 'event', ...event }) } catch { socket.destroy(); return false } })
  const unsubscribe = subscribeBrowserEvents(event => {
    if (event.params.__javisConnectionId !== connectionId || closed) return
    const { __javisConnectionId: _connection, ...params } = event.params
    try { writeBrowserFrame(socket, { type: 'event', method: event.method, params }) }
    catch { socket.destroy() }
  })
  socket.once('close', () => {
    if (closed) return
    closed = true; network.close(); unsubscribe(); onClose()
    for (const subscriptionId of subscriptions) void callBrowser('browser.screencast.unsubscribe', { subscriptionId, __javisCaller: caller }).catch(() => {})
    void callBrowser('browser.connection.close', { connectionId }).catch(() => {})
  })
  socket.on('data', chunk => {
    try {
      for (const frame of decoder.push(chunk)) {
        if (frame.token !== token || !Number.isSafeInteger(frame.id) || (frame.id as number) < 1 || requestIds.has(frame.id as number)) throw new JavisError('access_denied', 'Invalid authenticated browser stream request')
        if (activeRequests >= 2048) throw new JavisError('transport_error', 'Browser channel request budget exhausted')
        requestIds.add(frame.id as number)
        if (requestIds.size > 100_000) throw new JavisError('transport_error', 'Reconnect browser channel to renew request identifiers')
        if (typeof frame.method !== 'string' || !allowed.has(frame.method) && frame.method !== '__browserHost' && frame.method !== '__browserNetwork') throw new JavisError('access_denied', 'Browser stream method is not allowed')
        const method = frame.method
        if (method.startsWith('__browser') && identity.clientKind !== 'runtime') throw new JavisError('access_denied', 'Authenticated execution host required')
        if (!frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params)) throw new JavisError('invalid_argument', 'Browser stream parameters must be an object')
        const params = method.startsWith('__browser') ? frame.params as Record<string, unknown> : validateBrowserParams(method, frame.params)
        const operation = method === '__browserNetwork' ? Promise.resolve().then(() => network.call(params)) : method === '__browserHost' ? dispatchBrowserHostRequest({ target: 'local', method: String(params.method), params: params.params as Record<string, unknown> }).then(response => { if (!response.ok) throw new JavisError(response.error.code, response.error.message, response.error.data); return response.result }) : callBrowser(method, { ...params, __javisCaller: caller }, {}, () => !closed && !socket.destroyed)
        activeRequests++
        void operation.then(result => {
          if (closed) {
            if (method === 'browser.screencast' && result && typeof result === 'object' && 'subscriptionId' in result) void callBrowser('browser.screencast.unsubscribe', { subscriptionId: result.subscriptionId }).catch(() => {})
            return
          }
          if (method === 'browser.screencast' && result && typeof result === 'object' && 'subscriptionId' in result) subscriptions.add(String(result.subscriptionId))
          writeBrowserFrame(socket, { id: frame.id, ok: true, result })
        }, error => { if (!closed) writeBrowserFrame(socket, { id: frame.id, ok: false, error: runtimeErrorDetails(error) }) }).catch(() => socket.destroy()).finally(() => activeRequests--)
      }
    } catch { socket.destroy() }
  })
}
