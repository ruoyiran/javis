import type { Readable, Writable } from 'node:stream'
import { JavisError } from '../../runtime/error.js'

const maxFrameBytes = 32 * 1024 * 1024

export class BrowserFrameDecoder {
  private pending = Buffer.alloc(0)
  push(chunk: Buffer): Record<string, unknown>[] {
    this.pending = Buffer.concat([this.pending, chunk])
    const frames: Record<string, unknown>[] = []
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32BE(0)
      if (!length || length > maxFrameBytes) throw new JavisError('transport_error', 'Browser frame exceeds the size limit')
      if (this.pending.length < length + 4) break
      const value: unknown = JSON.parse(this.pending.subarray(4, length + 4).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JavisError('transport_error', 'Invalid browser frame')
      frames.push(value as Record<string, unknown>)
      this.pending = this.pending.subarray(length + 4)
    }
    return frames
  }
  finish(): void {
    if (this.pending.length) throw new JavisError('transport_error', 'Browser channel closed during a frame; action delivery may be uncertain')
  }
}

export function writeBrowserFrame(output: Writable, value: unknown): boolean {
  const body = Buffer.from(JSON.stringify(value))
  if (body.length > maxFrameBytes || output.writableLength > maxFrameBytes) throw new JavisError('transport_error', 'Browser stream backpressure limit exceeded')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length)
  output.write(Buffer.concat([header, body]))
  return true
}

export type BrowserStreamEvent = { method: string; params: Record<string, unknown> }
export type BrowserStream = { call(method: string, params: Record<string, unknown>): Promise<unknown>; close(): void }
export type BrowserCallerIdentity = { pairedDeviceId: string; clientKind: 'runtime' | 'mobile'; clientCapabilities?: string[] }
export type BrowserStreamOptions = { identity: BrowserCallerIdentity; onEvent(event: BrowserStreamEvent): void; onClose?(error: Error): void }

export function createBrowserStreamClient(input: Readable, output: Writable, options: BrowserStreamOptions, authenticate: (frame: Record<string, unknown>) => Record<string, unknown> = value => value): BrowserStream {
  const decoder = new BrowserFrameDecoder()
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  let id = 0
  let closed = false
  const close = (error = new JavisError('transport_error', 'Browser channel closed; action delivery may be uncertain')) => {
    if (closed) return
    closed = true
    input.off('data', data)
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear()
    input.destroy(); output.destroy()
    options.onClose?.(error)
  }
  const data = (chunk: Buffer) => {
    try {
      for (const frame of decoder.push(chunk)) {
        if (frame.type === 'event' && typeof frame.method === 'string' && frame.params && typeof frame.params === 'object') {
          options.onEvent({ method: frame.method, params: frame.params as Record<string, unknown> }); continue
        }
        const request = pending.get(frame.id as number)
        if (!request) throw new JavisError('transport_error', 'Unknown browser response ID')
        pending.delete(frame.id as number); clearTimeout(request.timer)
        if (frame.ok === true) request.resolve(frame.result)
        else {
          const error = frame.error as { code?: string; message?: string; data?: unknown } | undefined
          request.reject(new JavisError(error?.code ?? 'transport_error', error?.message ?? 'Browser request failed', error?.data))
        }
      }
    } catch (error) { close(error instanceof JavisError ? error : new JavisError('transport_error', 'Invalid browser frame')) }
  }
  input.on('data', data); input.once('error', close); output.once('error', close)
  input.once('end', () => { try { decoder.finish(); close() } catch (error) { close(error as JavisError) } })
  input.once('close', () => close())
  return {
    call: (method, params) => new Promise((resolve, reject) => {
      if (closed) { reject(new JavisError('transport_error', 'Browser channel is disconnected')); return }
      if (pending.size >= 2048) { reject(new JavisError('transport_error', 'Browser channel request budget exhausted')); return }
      const requestId = ++id
      const timer = setTimeout(() => close(new JavisError('action_timeout', 'Browser stream request timed out; action delivery may be uncertain')), Math.max(90_000, typeof params.timeout === 'number' ? params.timeout + 30_000 : 0))
      pending.set(requestId, { resolve, reject, timer })
      try { writeBrowserFrame(output, authenticate({ id: requestId, method, params })) }
      catch (error) { close(error as JavisError) }
    }),
    close: () => close()
  }
}
