import { expect, test, vi } from 'vitest'
import type { BrowserStream, BrowserStreamOptions } from '../../../src/browser/remote/framed-channel.js'

const hooks = vi.hoisted(() => ({ connect: undefined as unknown as (host: string, options: BrowserStreamOptions) => Promise<BrowserStream>, dispatch: undefined as unknown as (method: string, params: Record<string, unknown>) => Promise<unknown> }))
vi.mock('../../../src/runtime/remote-stdio.js', () => ({ connectRemoteJavisBrowserStream: (host: string, options: BrowserStreamOptions) => hooks.connect(host, options) }))
vi.mock('../../../src/browser/runtime/browser-process.js', () => ({ callBrowser: (method: string, params: Record<string, unknown>) => hooks.dispatch ? hooks.dispatch(method, params) : Promise.resolve({ accepted: true }) }))
import { BrowserHostSubscriptions } from '../../../src/browser/remote/host-subscriptions.js'

test('cancelling a pending host subscription closes its eventual SSH resource without starting a route', async () => {
  let resolve!: (connection: BrowserStream) => void
  hooks.connect = () => new Promise(connection => resolve = connection)
  const terminal: unknown[] = []
  const subscriptions = new BrowserHostSubscriptions()
  const opening = subscriptions.accept({ method: 'browser.host.subscribe', params: { id: 'network-1', target: 'fixture-ssh', __javisCaller: { clientKind: 'runtime', connectionId: 'connection-1', pairedDeviceId: 'paired-1' }, method: 'network.browserTunnel', params: {} } })
  await subscriptions.accept({ method: 'browser.host.unsubscribe', params: { id: 'network-1' } })
  resolve({ close: () => terminal.push({ type: 'closed', host: 'fixture-ssh' }), call: async () => { throw new Error('Cancelled route must not be started') } })
  await opening
  expect(terminal).toEqual([{ type: 'closed', host: 'fixture-ssh' }])
  subscriptions.close()
})

import { BrowserHostLeaseRegistry } from '../../../src/browser/source/main/runtime/browser-host/leases/browser-host-lease-registry.js'
import type { BrowserTunnelLeaseHandle } from '../../../src/browser/source/main/runtime/browser-host/leases/browser-host-lease-records.js'

function authorityFixture(subscriptions: BrowserHostSubscriptions, response: (value: Record<string, unknown>) => void) {
  const leases = new BrowserHostLeaseRegistry({ authorityRuntimeId: 'authority-1', authorityEpoch: 'epoch-1' })
  const owner = leases.attach({ browserHostClientId: 'host-1', connectionId: 'connection-1', pairedDeviceId: 'paired-1', hostCapabilities: ['webview'] })
  const handles = new Map<string, BrowserTunnelLeaseHandle>()
  hooks.dispatch = async (method, params) => {
    if (method === 'browser.host.subscription') { response(params); return { accepted: true } }
    if (method === 'browser.host.release') { handles.get(String(params.id))?.release(); handles.delete(String(params.id)); return { released: true } }
    if (method !== 'browser.host.admit') return { accepted: true }
    const request = params.params as { authorityRuntimeId: string; authorityEpoch: string; browserHostGeneration: number }
    if (request.authorityRuntimeId !== 'authority-1') throw new Error('Browser network authority mismatch')
    const caller = params.__javisCaller as { pairedDeviceId: string }
    const identity = { authorityEpoch: request.authorityEpoch, browserHostClientId: 'host-1', browserHostGeneration: request.browserHostGeneration, pairedDeviceId: caller.pairedDeviceId, executionHostKey: 'granted-host' }
    leases.requireLease(identity)
    leases.requireExecutionHost(identity, 'granted-host')
    const handle = leases.openTunnel(identity, { requireExecutionHostGrant: true })
    handles.set(String(params.id), handle)
    void handle.whenFenced.then(reason => subscriptions.accept({ method: 'browser.host.revoked', params: { id: params.id, reason } }))
    return { admitted: true, tunnelGeneration: handle.tunnelGeneration, _meta: { runtimeId: 'authority-1' } }
  }
  return { owner, grant: () => leases.grantExecutionHost({ authorityEpoch: 'epoch-1', browserHostClientId: 'host-1', browserHostGeneration: 1, pairedDeviceId: 'paired-1' }, 'granted-host') }
}
const networkRequest = { target: 'local', method: 'network.browserTunnel', __javisCaller: { clientKind: 'runtime', connectionId: 'connection-1', pairedDeviceId: 'paired-1' }, params: { authorityRuntimeId: 'authority-1', authorityEpoch: 'epoch-1', browserHostGeneration: 1 } }

test('stale authority and missing execution grants are rejected before native route readiness', async () => {
  const subscriptions = new BrowserHostSubscriptions()
  const responses: Record<string, unknown>[] = []
  const fixture = authorityFixture(subscriptions, value => responses.push(value))
  await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, id: 'stale', params: { ...networkRequest.params, authorityEpoch: 'old-epoch' } } })
  await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, id: 'ungranted' } })
  expect(responses).toEqual([
    { id: 'stale', response: { ok: false, error: { code: 'internal_error', message: 'browser_host_lease_stale' } } },
    { id: 'ungranted', response: { ok: false, error: { code: 'internal_error', message: 'browser_tunnel_execution_host_not_granted' } } }
  ])
  await subscriptions.close(); fixture.owner.release()
})

test('source grant revocation closes the admitted generation and preserves verified authority metadata', async () => {
  const subscriptions = new BrowserHostSubscriptions()
  const responses: Record<string, unknown>[] = []
  let finished!: () => void
  const closed = new Promise<void>(resolve => finished = resolve)
  const fixture = authorityFixture(subscriptions, value => { responses.push(value); if ((value.response as { result?: { type?: string } }).result?.type === 'closed') finished() })
  const grant = fixture.grant()
  await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, id: 'route-1' } })
  expect(responses[0]).toMatchObject({ id: 'route-1', response: { ok: true, result: { type: 'ready', tunnelGeneration: 1 }, _meta: { runtimeId: 'authority-1' } } })
  grant.release()
  await closed
  expect(responses[1]).toEqual({ id: 'route-1', response: { ok: true, result: { type: 'closed', tunnelGeneration: 1 }, _meta: { runtimeId: 'authority-1' } } })
  await subscriptions.close(); fixture.owner.release()
})

test('source route replacement and owner disconnect retire their own admitted generations', async () => {
  const subscriptions = new BrowserHostSubscriptions()
  const events: { id: unknown; type: unknown; tunnelGeneration: unknown; authority: unknown }[] = []
  let firstClosed!: () => void; let secondClosed!: () => void
  const replaced = new Promise<void>(resolve => firstClosed = resolve)
  const disconnected = new Promise<void>(resolve => secondClosed = resolve)
  const fixture = authorityFixture(subscriptions, value => {
    const response = value.response as { result?: { type?: string; tunnelGeneration?: number }; _meta?: { runtimeId?: string } }
    events.push({ id: value.id, type: response.result?.type, tunnelGeneration: response.result?.tunnelGeneration, authority: response._meta?.runtimeId })
    if (value.id === 'route-1' && response.result?.type === 'closed') firstClosed()
    if (value.id === 'route-2' && response.result?.type === 'closed') secondClosed()
  })
  const grant = fixture.grant()
  await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, id: 'route-1' } })
  await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, id: 'route-2' } })
  await replaced
  fixture.owner.disconnect()
  await disconnected
  expect(events).toEqual([
    { id: 'route-1', type: 'ready', tunnelGeneration: 1, authority: 'authority-1' },
    { id: 'route-1', type: 'closed', tunnelGeneration: 1, authority: 'authority-1' },
    { id: 'route-2', type: 'ready', tunnelGeneration: 2, authority: 'authority-1' },
    { id: 'route-2', type: 'closed', tunnelGeneration: 2, authority: 'authority-1' }
  ])
  await subscriptions.close(); grant.release(); fixture.owner.release()
})

test('remote renderer stream preserves packet admission and invokes frame acknowledgment on its authenticated connection', async () => {
  const emitted: { method: string; params: Record<string, unknown> }[] = []
  const transmitted: { method: string; params: Record<string, unknown> }[] = []
  hooks.dispatch = async (method, params) => { emitted.push({ method, params }); return { accepted: true } }
  hooks.connect = async (_host, options) => ({ close() {}, call: async (method, params) => {
    if (method === 'browser.status') return { runtimeId: 'remote-authority' }
    if (method === 'browser.screencast') {
      options.onEvent({ method, params: { type: 'ready', browserPageId: 'remote-page', subscriptionId: 'remote-stream' } })
      options.onEvent({ method: 'browser.stream.binary', params: { method, packetId: 'packet-1', subscriptionId: 'remote-stream', __javisConnectionId: 'remote-connection', bytes: 'AQ==' } })
      return { subscriptionId: 'remote-stream' }
    }
    transmitted.push({ method, params })
    return { credited: true }
  } })
  const subscriptions = new BrowserHostSubscriptions()
  await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, id: 'renderer-stream', target: 'fixture-ssh', method: 'browser.screencast', params: { page: 'remote-page', frameAck: 1 } } })
  expect(emitted).toEqual([
    { method: 'browser.host.subscription', params: { id: 'renderer-stream', response: { ok: true, result: { type: 'ready', browserPageId: 'remote-page', subscriptionId: 'remote-stream' }, _meta: { runtimeId: 'remote-authority' } } } },
    { method: 'browser.host.binary', params: { id: 'renderer-stream', method: 'browser.screencast', packetId: 'packet-1', subscriptionId: 'remote-stream', __javisConnectionId: 'remote-connection', bytes: 'AQ==' } }
  ])
  await subscriptions.accept({ method: 'browser.host.delivery', params: { id: 'renderer-stream', packetId: 'packet-1', outcome: true, backlogged: false } })
  await subscriptions.accept({ method: 'browser.host.invoke', params: { id: 'renderer-stream', requestId: 'ack-1', method: 'browser.screencast.ack', params: { subscriptionId: 'remote-stream', seq: 1 } } })
  expect(transmitted).toEqual([
    { method: '__browserDelivery', params: { packetId: 'packet-1', outcome: true, backlogged: false } },
    { method: 'browser.screencast.ack', params: { subscriptionId: 'remote-stream', seq: 1 } }
  ])
  expect(emitted[2]).toEqual({ method: 'browser.host.invokeReply', params: { id: 'renderer-stream', requestId: 'ack-1', response: { ok: true, result: { credited: true }, _meta: { runtimeId: 'remote-authority' } } } })
  await subscriptions.close()
})

import net from 'node:net'
import { encodeBrowserNetworkTunnelFrame, encodeBrowserNetworkTunnelOpen, BrowserNetworkTunnelOpcode } from '../../../src/browser/source/shared/browser/network/tunnels/browser-network-tunnel-protocol.js'

test('revocation closes actual native egress while authority release remains unresolved', async () => {
  let opened!: () => void; let closed!: () => void; let release!: () => void
  const connected = new Promise<void>(resolve => opened = resolve)
  const disconnected = new Promise<void>(resolve => closed = resolve)
  const releasePending = new Promise<void>(resolve => release = resolve)
  const sockets = new Set<net.Socket>()
  const destination = net.createServer(socket => { sockets.add(socket); opened(); socket.once('close', () => { sockets.delete(socket); closed() }) })
  await new Promise<void>(resolve => destination.listen(0, '127.0.0.1', resolve))
  hooks.dispatch = async method => {
    if (method === 'browser.host.admit') return { admitted: true, tunnelGeneration: 7, _meta: { runtimeId: 'authority-1' } }
    if (method === 'browser.host.release') await releasePending
    return { accepted: true }
  }
  const subscriptions = new BrowserHostSubscriptions()
  try {
    await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, id: 'route-active' } })
    const bytes = encodeBrowserNetworkTunnelFrame({ opcode: BrowserNetworkTunnelOpcode.Open, tunnelGeneration: 7, streamId: 1, payload: encodeBrowserNetworkTunnelOpen({ host: '127.0.0.1', port: (destination.address() as net.AddressInfo).port }) })
    await subscriptions.accept({ method: 'browser.host.sendBinary', params: { id: 'route-active', bytes: Buffer.from(bytes).toString('base64') } })
    await connected
    await subscriptions.accept({ method: 'browser.host.revoked', params: { id: 'route-active', reason: 'released' } })
    await disconnected
    release()
  } finally {
    release(); await subscriptions.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => destination.close(() => resolve()))
  }
})

test('revocation closes the selected SSH resource before its pending authority release', async () => {
  let release!: () => void
  const releasePending = new Promise<void>(resolve => release = resolve)
  const terminal: { type: string; host: string }[] = []
  hooks.dispatch = async () => ({ accepted: true })
  hooks.connect = async () => ({ close: () => terminal.push({ type: 'closed', host: 'fixture-ssh' }), call: async (method, params) => {
    if (method === '__browserAuthority' && params.method === 'browser.host.admit') return { admitted: true, tunnelGeneration: 4, _meta: { runtimeId: 'remote-authority' } }
    if (method === '__browserAuthority' && params.method === 'browser.host.release') await releasePending
    return { subscriptionId: 'remote-route', tunnelGeneration: 4 }
  } })
  const subscriptions = new BrowserHostSubscriptions()
  try {
    await subscriptions.accept({ method: 'browser.host.subscribe', params: { ...networkRequest, target: 'fixture-ssh', id: 'remote-route' } })
    await subscriptions.accept({ method: 'browser.host.revoked', params: { id: 'remote-route' } })
    expect(terminal).toEqual([{ type: 'closed', host: 'fixture-ssh' }])
  } finally { release(); await subscriptions.close() }
})
