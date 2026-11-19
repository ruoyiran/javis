import { connectNativeBrowserNetworkTarget } from '../source/main/browser/network/execution-routes/browser-network-execution-route.js'
import { BrowserNetworkTunnelOutboundMemoryBudgetRegistry } from '../source/main/browser/network/tunnels/browser-network-tunnel-outbound-memory-budget.js'
import { randomUUID } from 'node:crypto'
import { BrowserNetworkTunnelSession } from '../source/main/browser/network/tunnels/browser-network-tunnel-session.js'
import { BROWSER_NETWORK_TUNNEL_WINDOW_V2_FLOW_CONTROL } from '../source/main/browser/network/tunnels/browser-network-tunnel-stream-state.js'
import { JavisError } from '../../runtime/error.js'
import type { BrowserStreamEvent } from './framed-channel.js'

const memoryBudgets = new BrowserNetworkTunnelOutboundMemoryBudgetRegistry()

export class BrowserHostNetworkSessions {
  private sessions = new Map<string, BrowserNetworkTunnelSession>()
  private generation = 0
  private readonly memoryIdentity = randomUUID()
  constructor(private readonly emit: (event: BrowserStreamEvent) => boolean) {}

  call(params: Record<string, unknown>): unknown {
    if (params.action === 'open') {
      if (this.sessions.size >= 32) throw new JavisError('access_denied', 'Browser network route budget exhausted')
      const subscriptionId = randomUUID()
      const tunnelGeneration = ++this.generation
      const memory = memoryBudgets.acquire(this.memoryIdentity)
      if (!memory) throw new JavisError('access_denied', 'Browser network memory admission failed')
      const session = new BrowserNetworkTunnelSession({
        tunnelGeneration,
        flowControl: BROWSER_NETWORK_TUNNEL_WINDOW_V2_FLOW_CONTROL,
        connect: connectNativeBrowserNetworkTarget,
        claimAggregateRetainedBytes: memory.claimApplicationBytes,
        sendBinary: bytes => this.emit({ method: 'network.browserTunnel.binary', params: { subscriptionId, bytes: Buffer.from(bytes).toString('base64') } }),
        onClose: () => { memory.release(); this.sessions.delete(subscriptionId); this.emit({ method: 'network.browserTunnel', params: { subscriptionId, type: 'closed', tunnelGeneration } }) }
      })
      this.sessions.set(subscriptionId, session)
      return { subscriptionId, type: 'ready', tunnelGeneration, capabilities: ['network.browserTunnel.window.v2'] }
    }
    if (typeof params.subscriptionId !== 'string') throw new JavisError('invalid_argument', 'Browser network subscription is required')
    const session = this.sessions.get(params.subscriptionId)
    if (!session) throw new JavisError('browser_host_unavailable', 'Browser network route is offline')
    if (params.action === 'close') { session.close(); return { closed: true } }
    if (params.action !== 'send' || typeof params.bytes !== 'string' || params.bytes.length > 100_000) throw new JavisError('invalid_argument', 'Invalid browser network frame')
    session.handleBinary(Buffer.from(params.bytes, 'base64'))
    return { sent: true }
  }
  close(): void { for (const session of [...this.sessions.values()]) session.close(); this.sessions.clear() }
}
