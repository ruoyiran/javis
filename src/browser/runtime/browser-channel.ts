import net from 'node:net'
import { chmod } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { JsonLineDecoder } from '../../runtime/transport.js'
import { JavisError } from '../../runtime/error.js'

export type BrowserEvent = { method: string; params: Record<string, unknown> }
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
type ChannelOptions = {
  address: string
  token: string
  expectedPid(): number | undefined
  onEvent?(event: BrowserEvent): void
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class BrowserChannel {
  private socket?: net.Socket
  private sockets = new Set<net.Socket>()
  private pending = new Map<number, Pending>()
  private sequence = 0
  private stopped = false
  private closing?: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void
  private readyPromise = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
  private server: net.Server

  constructor(private options: ChannelOptions) {
    this.readyPromise.catch(() => {})
    this.server = net.createServer(socket => this.accept(socket))
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      const listening = () => { this.server.off('error', reject); resolve() }
      if (process.platform === 'win32') this.server.listen({ path: this.options.address, readableAll: false, writableAll: false }, listening)
      else this.server.listen(this.options.address, listening)
    })
    this.server.on('error', () => { void this.close() })
    if (process.platform !== 'win32') await chmod(this.options.address, 0o600)
  }

  ready(): Promise<void> { return this.readyPromise }

  connected(): boolean { return !this.stopped && this.socket !== undefined && !this.socket.destroyed }

  request(method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
    const socket = this.socket
    if (this.stopped || !socket || socket.destroyed) {
      return Promise.reject(new JavisError('browser_host_unavailable', 'The browser is disconnected; inspect current state before repeating an action'))
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new JavisError('invalid_argument', 'Browser request timeout must be a positive integer'))
    const id = ++this.sequence
    let frame: string
    try { frame = JSON.stringify({ kind: 'request', id, method, params }) + '\n' }
    catch { return Promise.reject(new JavisError('invalid_argument', 'Browser request cannot be serialized')) }
    if (Buffer.byteLength(frame) > 32 * 1024 * 1024) return Promise.reject(new JavisError('invalid_argument', 'Browser request exceeds the size limit'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new JavisError('browser_action_timeout', 'Browser request timed out; action delivery may be uncertain')
        this.pending.delete(id)
        reject(error)
        void this.close(error)
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      socket.write(frame, error => { if (error) void this.close(this.disconnected()) })
    })
  }

  close(error = this.disconnected()): Promise<void> {
    if (this.closing) return this.closing
    this.stopped = true
    this.readyReject(error)
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    for (const socket of this.sockets) socket.destroy()
    this.socket = undefined
    this.closing = new Promise(resolve => {
      if (!this.server.listening) resolve()
      else this.server.close(() => resolve())
    })
    return this.closing
  }

  private disconnected(): JavisError {
    return new JavisError('browser_host_unavailable', 'The browser connection closed; action delivery may be uncertain. Inspect current state before repeating an action')
  }

  private accept(socket: net.Socket): void {
    if (this.stopped || this.socket) { socket.destroy(); return }
    this.sockets.add(socket)
    const decoder = new JsonLineDecoder()
    let authenticated = false
    socket.on('error', () => { if (authenticated) void this.close() })
    socket.on('close', () => { this.sockets.delete(socket); if (authenticated) void this.close() })
    socket.on('data', chunk => {
      try {
        for (const line of decoder.push(chunk)) {
          const input: unknown = JSON.parse(line)
          if (!record(input)) throw new Error('Invalid browser frame')
          if (!authenticated) {
            const expected = Buffer.from(this.options.token)
            const supplied = typeof input.token === 'string' ? Buffer.from(input.token) : Buffer.alloc(0)
            const pid = this.options.expectedPid()
            if (this.socket || input.kind !== 'ready' || input.protocolVersion !== 1 || pid === undefined || input.pid !== pid || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
              socket.destroy(); return
            }
            authenticated = true
            this.socket = socket
            this.readyResolve()
            continue
          }
          this.receive(input)
        }
      } catch {
        if (authenticated) void this.close(new JavisError('browser_transport_error', 'The browser sent an invalid frame; action delivery may be uncertain'))
        else socket.destroy()
      }
    })
  }

  private receive(input: Record<string, unknown>): void {
    if (input.kind === 'event' && typeof input.method === 'string' && record(input.params)) {
      this.options.onEvent?.({ method: input.method, params: input.params })
      return
    }
    if (input.kind !== 'response' || !Number.isSafeInteger(input.id)) throw new Error('Invalid browser response')
    const pending = this.pending.get(input.id as number)
    if (!pending) throw new Error('Unknown browser response ID')
    if (input.ok === true && Object.hasOwn(input, 'result')) {
      this.pending.delete(input.id as number); clearTimeout(pending.timer); pending.resolve(input.result)
    } else if (input.ok === false && record(input.error) && typeof input.error.code === 'string' && typeof input.error.message === 'string') {
      this.pending.delete(input.id as number); clearTimeout(pending.timer)
      pending.reject(new JavisError(input.error.code, input.error.message, input.error.data))
    } else throw new Error('Invalid browser result')
  }
}

export async function createBrowserChannel(options: ChannelOptions): Promise<BrowserChannel> {
  const channel = new BrowserChannel(options)
  try { await channel.listen(); return channel }
  catch (error) { await channel.close(); throw error }
}
