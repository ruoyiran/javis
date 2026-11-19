import { connectJavisBrowserStream } from '../../runtime/public.js'
import { callBrowser } from '../runtime/browser-process.js'
import { connectRemoteJavisBrowserStream } from '../../runtime/remote-stdio.js'
import { runtimeErrorDetails, JavisError } from '../../runtime/error.js'
import { BrowserHostNetworkSessions } from './network-session.js'
import type { BrowserCallerIdentity, BrowserStream, BrowserStreamEvent } from './framed-channel.js'

type HostRoute = {
  closed: boolean
  admitted: boolean
  subscriptionId?: string
  closeResource?: () => void
  callResource?: (params: Record<string, unknown>) => Promise<unknown>
  authority?: (method: string, params: Record<string, unknown>) => Promise<unknown>
  release?: Promise<void>
  metadata?: Record<string, unknown>
  tunnelGeneration?: number
  stream?: BrowserStream
}

export class BrowserHostSubscriptions {
  private routes = new Map<string, HostRoute>()
  private stopped = false

  private retire(id: string, route: HostRoute, notify = true): Promise<void> {
    if (!route.closed && notify && route.tunnelGeneration !== undefined) void callBrowser('browser.host.subscription', { id, response: { ok: true, result: { type: 'closed', tunnelGeneration: route.tunnelGeneration }, _meta: route.metadata } }).catch(() => {})
    route.closed = true
    if (this.routes.get(id) === route) this.routes.delete(id)
    if (route.admitted && route.authority && !route.release) {
      route.release = Promise.resolve().then(() => route.authority!('browser.host.release', { id })).then(() => {}, () => {})
    }
    const closeResource = route.closeResource
    route.closeResource = undefined
    route.stream = undefined
    route.callResource = undefined
    closeResource?.()
    return Promise.resolve()
  }

  async accept(event: BrowserStreamEvent): Promise<void> {
    const { id } = event.params
    if (typeof id !== 'string' || this.stopped) return
    const previous = this.routes.get(id)
    if (event.method === 'browser.host.unsubscribe' || event.method === 'browser.host.revoked') {
      if (previous) await this.retire(id, previous, event.method !== 'browser.host.unsubscribe')
      return
    }
    if (event.method === 'browser.host.invoke') {
      if (!previous?.stream || previous.closed) return
      let response
      try { response = { ok: true, result: await previous.stream.call(String(event.params.method), event.params.params as Record<string, unknown>), _meta: previous.metadata } }
      catch (error) { response = { ok: false, error: runtimeErrorDetails(error), _meta: previous.metadata } }
      await callBrowser('browser.host.invokeReply', { id, requestId: event.params.requestId, response })
      return
    }
    if (event.method === 'browser.host.delivery') {
      if (previous?.stream && !previous.closed) await previous.stream.call('__browserDelivery', { packetId: event.params.packetId, outcome: event.params.outcome, backlogged: event.params.backlogged })
      return
    }
    if (event.method === 'browser.host.flow') { previous?.stream?.setBacklogged?.(event.params.backlogged === true); return }
    if (event.method === 'browser.host.sendBinary') {
      if (previous && !previous.closed && previous.subscriptionId) {
        try { await previous.callResource?.({ action: 'send', subscriptionId: previous.subscriptionId, bytes: event.params.bytes }) }
        catch { await this.retire(id, previous) }
      }
      return
    }
    if (event.method !== 'browser.host.subscribe') return
    if (previous) await this.retire(id, previous)
    const route: HostRoute = { closed: false, admitted: false }
    this.routes.set(id, route)
    try {
      if (!['network.browserTunnel', 'browser.screencast'].includes(String(event.params.method))) throw new JavisError('invalid_argument', 'Unknown browser host subscription')
      const caller = event.params.__javisCaller as BrowserCallerIdentity & { connectionId?: string } | undefined
      if (!caller || caller.clientKind !== 'runtime' || !caller.pairedDeviceId || !caller.connectionId) throw new JavisError('access_denied', 'Authenticated browser network owner required')
      if (event.params.method === 'browser.screencast') {
        const options = { identity: caller, forwardDelivery: true, onEvent: (source: BrowserStreamEvent) => {
          if (route.closed) return
          if (source.method === 'browser.stream.binary' && source.params.method === 'browser.screencast') void callBrowser('browser.host.binary', { ...source.params, id }).catch(() => this.retire(id, route))
          else if (source.method === 'browser.screencast') {
            if (typeof source.params.subscriptionId === 'string') route.subscriptionId = source.params.subscriptionId
            void callBrowser('browser.host.subscription', { id, response: { ok: true, result: source.params, _meta: route.metadata } }).catch(() => this.retire(id, route))
            if (source.params.type === 'end' || source.params.type === 'error') void this.retire(id, route)
          }
        }, onClose: () => { void this.retire(id, route) } }
        const stream = event.params.target === 'local' ? await connectJavisBrowserStream(options) : await connectRemoteJavisBrowserStream(String(event.params.target), options)
        route.stream = stream; route.closeResource = () => stream.close()
        if (route.closed || this.stopped) { await this.retire(id, route); return }
        const status = await stream.call('browser.status', {}) as { runtimeId?: string }
        if (!status.runtimeId) throw new JavisError('access_denied', 'Browser host identity is unavailable')
        route.metadata = { runtimeId: status.runtimeId }
        if (route.closed || this.stopped) { await this.retire(id, route); return }
        await stream.call('browser.screencast', event.params.params as Record<string, unknown>)
        return
      }
      const forward = (source: BrowserStreamEvent) => {
        if (route.closed) return
        if (source.method === 'browser.host.revoked') { void this.retire(id, route); return }
        if (source.method === 'network.browserTunnel.binary') void callBrowser('browser.host.binary', { id, bytes: source.params.bytes }).catch(() => this.retire(id, route))
        else {
          void callBrowser('browser.host.subscription', { id, response: { ok: true, result: source.params, _meta: route.metadata } }).catch(() => this.retire(id, route))
          if (source.params.type === 'closed') void this.retire(id, route)
        }
      }
      if (event.params.target === 'local') {
        const sessions = new BrowserHostNetworkSessions(source => { forward(source); return !route.closed })
        route.authority = (method, params) => callBrowser(method, { ...params, __javisCaller: caller })
        route.callResource = async params => sessions.call(params)
        route.closeResource = () => sessions.close()
      } else {
        const connection: BrowserStream = await connectRemoteJavisBrowserStream(String(event.params.target), { identity: caller, onEvent: forward, onClose: () => { void this.retire(id, route) } })
        route.authority = (method, params) => connection.call('__browserAuthority', { method, params })
        route.callResource = params => connection.call('__browserNetwork', params)
        route.closeResource = () => connection.close()
      }
      if (route.closed || this.stopped) { await this.retire(id, route); return }
      const admission = await route.authority('browser.host.admit', { id, params: event.params.params }) as { admitted?: boolean; tunnelGeneration?: number; _meta?: Record<string, unknown> }
      route.admitted = admission.admitted === true
      if (!admission.admitted || !Number.isSafeInteger(admission.tunnelGeneration) || !admission._meta || typeof admission._meta.runtimeId !== 'string') throw new JavisError('access_denied', 'Browser authority did not admit the network route')
      route.admitted = true
      route.metadata = admission._meta
      route.tunnelGeneration = admission.tunnelGeneration
      if (route.closed || this.stopped) { await this.retire(id, route); return }
      const ready = await route.callResource({ action: 'open', admissionId: id, tunnelGeneration: admission.tunnelGeneration }) as Record<string, unknown>
      route.subscriptionId = String(ready.subscriptionId)
      if (route.closed || this.stopped) { await this.retire(id, route); return }
      if (ready.tunnelGeneration !== admission.tunnelGeneration) throw new JavisError('access_denied', 'Browser network route generation mismatch')
      await callBrowser('browser.host.subscription', { id, response: { ok: true, result: ready, _meta: route.metadata } })
    } catch (error) {
      const cancelled = route.closed || this.stopped
      await this.retire(id, route)
      if (!cancelled) await callBrowser('browser.host.subscription', { id, response: { ok: false, error: runtimeErrorDetails(error) } })
    }
  }
  async close(): Promise<void> { this.stopped = true; await Promise.allSettled([...this.routes].map(async ([id, route]) => this.retire(id, route))) }
}
