import { randomUUID } from 'node:crypto'
export class BrowserHostBridge {
  private readonly pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly emit: (event: { method: string; params: Record<string, unknown> }) => void) {}
  call(target: string, method: string, params: unknown, timeoutMs = 15_000): Promise<any> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('browser_host_request_timeout')) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.emit({ method: 'browser.host.request', params: { id, target, method, params } })
    })
  }
  reply(params: Record<string, any>): boolean {
    const pending = this.pending.get(params.id)
    if (!pending) return false
    this.pending.delete(params.id)
    clearTimeout(pending.timer)
    pending.resolve(params.response)
    return true
  }
  close(): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('browser_host_disconnected')) }
    this.pending.clear()
  }
}
