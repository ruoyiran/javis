import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export class AnnotationQueue {
  private readonly deliveries: Record<string, { id: string; status: 'queued' | 'acknowledged'; payload: Record<string, unknown> }>
  constructor(private readonly path: string) {
    this.deliveries = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  }
  enqueue(payload: Record<string, unknown>) {
    const key = payload.deliveryId
    if (typeof key !== 'string' || !key || !Array.isArray(payload.annotations)) throw new Error('invalid_annotation_delivery')
    const existing = this.deliveries[key]
    if (existing) return { id: existing.id, status: existing.status }
    const row = { id: randomUUID(), status: 'queued' as const, payload }
    this.deliveries[key] = row
    this.persist()
    return { id: row.id, status: row.status }
  }
  get(id: string) { return Object.values(this.deliveries).find(row => row.id === id) }
  list(context?: string, includeAcknowledged = false) { return Object.values(this.deliveries).filter(row => (includeAcknowledged || row.status === 'queued') && (!context || row.payload.context === context)) }
  acknowledge(id: string) {
    const row = Object.values(this.deliveries).find(row => row.id === id)
    if (!row) throw new Error('annotation_delivery_not_found')
    row.status = 'acknowledged'
    this.persist()
    return { id, status: row.status }
  }
  private persist() {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.deliveries), { mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
  }
}
