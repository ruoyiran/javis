import { callBrowser } from '../runtime/browser-process.js'
import { connectRemoteJavisBrowserStream } from '../../runtime/remote-stdio.js'
import { runtimeErrorDetails, JavisError } from '../../runtime/error.js'
import { BrowserHostNetworkSessions } from './network-session.js'
import type { BrowserStream, BrowserStreamEvent } from './framed-channel.js'

export class BrowserHostSubscriptions {
  private subscriptions = new Map<string, { call(params: Record<string, unknown>): Promise<unknown>; close(): void; subscriptionId?: string }>()
  private stopped = false
  private pending = new Map<string, { cancelled: boolean }>()

  async accept(event: BrowserStreamEvent): Promise<void> {
    const { id } = event.params
    if (typeof id !== 'string' || this.stopped) return
    if (event.method === 'browser.host.unsubscribe') { const pending = this.pending.get(id); if (pending) pending.cancelled = true; this.subscriptions.get(id)?.close(); this.subscriptions.delete(id); return }
    if (event.method === 'browser.host.sendBinary') {
      const subscription = this.subscriptions.get(id)
      if (subscription) await subscription.call({ action: 'send', subscriptionId: subscription.subscriptionId, bytes: event.params.bytes })
      return
    }
    if (event.method !== 'browser.host.subscribe') return
    const { target, method } = event.params
    const pending = { cancelled: false }
    this.pending.set(id, pending)
    try {
      if (method !== 'network.browserTunnel') throw new JavisError('invalid_argument', 'Unknown browser host subscription')
      const forward = (source: BrowserStreamEvent) => {
        if (this.stopped || !this.subscriptions.has(id)) return
        if (source.method === 'network.browserTunnel.binary') void callBrowser('browser.host.binary', { id, bytes: source.params.bytes }).catch(() => this.subscriptions.get(id)?.close())
        else void callBrowser('browser.host.subscription', { id, response: { ok: true, result: source.params } }).catch(() => this.subscriptions.get(id)?.close())
      }
      let resource: { call(params: Record<string, unknown>): Promise<unknown>; close(): void; subscriptionId?: string }
      if (target === 'local') {
        const sessions = new BrowserHostNetworkSessions(source => { forward(source); return !this.stopped })
        resource = { call: async params => sessions.call(params), close: () => sessions.close() }
      } else {
        const connection: BrowserStream = await connectRemoteJavisBrowserStream(String(target), { identity: { pairedDeviceId: `browser-network:${id}`, clientKind: 'runtime' }, onEvent: forward, onClose: () => { forward({ method: 'network.browserTunnel', params: { type: 'closed' } }); this.subscriptions.delete(id) } })
        resource = { call: params => connection.call('__browserNetwork', params), close: () => connection.close() }
      }
      if (this.stopped || pending.cancelled) { resource.close(); return }
      this.subscriptions.set(id, resource)
      const ready = await resource.call({ action: 'open', params: event.params.params }) as Record<string, unknown>
      resource.subscriptionId = String(ready.subscriptionId)
      if (pending.cancelled || this.stopped || !this.subscriptions.has(id)) { resource.close(); return }
      await callBrowser('browser.host.subscription', { id, response: { ok: true, result: ready } })
    } catch (error) {
      this.subscriptions.get(id)?.close(); this.subscriptions.delete(id)
      if (!pending.cancelled && !this.stopped) await callBrowser('browser.host.subscription', { id, response: { ok: false, error: runtimeErrorDetails(error) } })
    } finally { this.pending.delete(id) }
  }
  close(): void { this.stopped = true; for (const pending of this.pending.values()) pending.cancelled = true; for (const subscription of this.subscriptions.values()) subscription.close(); this.subscriptions.clear() }
}
