import type { RemoteRuntimeTransportSubscription, RemoteRuntimeTransportSubscriptionCallbacks, RemoteRuntimeSubscriptionOptions } from '../../../shared/remote-runtime/requests/remote-runtime-subscription-contract'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
export type BrowserHostTransport = (target: string, method: string, params: unknown, timeoutMs?: number) => Promise<RuntimeRpcResponse<unknown>>
export type BrowserHostSubscriptionOptions = RemoteRuntimeSubscriptionOptions & { javisEnvironmentId?:string; javisCaller?: { connectionId: string; pairedDeviceId: string; clientKind: 'runtime' | 'mobile'; clientCapabilities?: string[] } }
export type BrowserHostCallbacks = RemoteRuntimeTransportSubscriptionCallbacks & { onPacket?: (packet: { id: string; bytes: string; packetId?: string; subscriptionId?: string; __javisConnectionId?: string }) => void }
export type BrowserHostSubscribe = (target: string, method: string, params: unknown, callbacks: BrowserHostCallbacks, options?: BrowserHostSubscriptionOptions) => Promise<RemoteRuntimeTransportSubscription>
let transport: BrowserHostTransport | null = null
let subscription: BrowserHostSubscribe | null = null
export function setBrowserHostTransport(next: BrowserHostTransport, subscribe?: BrowserHostSubscribe): void { transport = next; subscription = subscribe ?? null }
export async function callRuntimeEnvironment(_dataDirectory: string, target: string, method: string, params: unknown, timeoutMs?: number, _revision?: number, _caller?: unknown, options?: { signal?: AbortSignal }): Promise<RuntimeRpcResponse<unknown>> {
  if (!transport) throw new Error('browser_host_transport_unavailable')
  const signal = options?.signal
  if (signal?.aborted) throw signal.reason ?? new Error('browser_host_request_aborted')
  const request = transport(target, method, params, timeoutMs)
  if (!signal) return request
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error('browser_host_request_aborted'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([request, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}
export function subscribeBrowserHostTransport(target: string, method: string, params: unknown, callbacks: BrowserHostCallbacks, options?: BrowserHostSubscriptionOptions): Promise<RemoteRuntimeTransportSubscription> {
  if (!subscription) throw new Error('browser_host_transport_unavailable')
  return subscription(target, method, params, callbacks, options)
}
export function subscribeRuntimeEnvironment(_dataDirectory: string, target: string, method: string, params: unknown, _timeout: number, callbacks: BrowserHostCallbacks, _revision?: number, options?: BrowserHostSubscriptionOptions): Promise<RemoteRuntimeTransportSubscription> {
  return subscribeBrowserHostTransport(target, method, params, callbacks, options)
}
