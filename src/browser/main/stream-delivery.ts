import { randomUUID } from 'node:crypto'
type Event = { method: string; params: Record<string, unknown> }
type Packet = Event & { packetId: string; connectionId: string; subscriptionId?: string; retry: boolean }
export class BrowserStreamDelivery {
  private readonly pending = new Map<string, Packet>()
  private readonly backlogged = new Set<string>()
  constructor(private readonly emit: (event: Event) => void) {}
  send(connectionId: string, subscriptionId: string | undefined, method: string, bytes: Uint8Array, lossy: boolean): boolean | 'backlogged' {
    if (lossy && (this.backlogged.has(connectionId) || this.pending.has(connectionId))) return 'backlogged'
    const packetId = randomUUID()
    const event: Packet = { method: 'browser.stream.binary', params: { method, packetId, subscriptionId, __javisSubscriptionId: subscriptionId, __javisConnectionId: connectionId, bytes: Buffer.from(bytes).toString('base64') }, packetId, connectionId, subscriptionId, retry: false }
    if (lossy) this.pending.set(connectionId, event)
    this.emit(event)
    return true
  }
  acknowledge(input: { connectionId: string; packetId: string; outcome: boolean | 'backlogged'; backlogged?: boolean }): boolean {
    const packet = this.pending.get(input.connectionId)
    if (!packet || packet.packetId !== input.packetId) return false
    if (input.outcome === 'backlogged') { packet.retry = true; this.backlogged.add(input.connectionId) }
    else this.pending.delete(input.connectionId)
    if (input.backlogged === true) this.backlogged.add(input.connectionId)
    return true
  }
  flow(connectionId: string, backlogged: boolean): void {
    if (backlogged) { this.backlogged.add(connectionId); return }
    this.backlogged.delete(connectionId)
    const packet = this.pending.get(connectionId)
    if (packet?.retry) { packet.retry = false; this.emit(packet) }
  }
  replace(connectionId: string, subscriptionId: string): void { if (this.pending.get(connectionId)?.subscriptionId !== subscriptionId) this.pending.delete(connectionId) }
  close(connectionId: string): void { this.pending.delete(connectionId); this.backlogged.delete(connectionId) }
}
