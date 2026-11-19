import { randomUUID } from 'node:crypto'
import type { BrowserStream, BrowserStreamEvent, BrowserStreamOptions } from '../browser/remote/framed-channel.js'
import { JavisError } from '../runtime/error.js'
import { decodeBrowserScreencastFrame } from '../browser/source/shared/browser/screencast/browser-screencast-protocol.js'

export type MobileBrowserTarget = { page: string; worktree: string; profileId?: string; sessionId: string; url: string; observedAt: number; width: number; height: number }
const actions: Record<string, readonly string[]> = {
  'browser.goto': ['url'], 'browser.click': ['element'], 'browser.fill': ['element', 'value'],
  'browser.type': ['input'], 'browser.keypress': ['key'], 'browser.scroll': ['direction', 'amount'],
  'browser.mouseMove': ['x', 'y'], 'browser.mouseClick': ['x', 'y', 'button', 'radius', 'modifiers'], 'browser.mouseDown': ['button'], 'browser.mouseUp': ['button'], 'browser.mouseWheel': ['dx', 'dy']
}

export class MobileBrowserSession {
  readonly pairedDeviceId = randomUUID()
  target: MobileBrowserTarget | null = null
  requiresRefresh = true
  subscriptionId: string | null = null
  frameSeq: number | null = null
  private stream?: BrowserStream
  private opening?: Promise<BrowserStream>
  private viewer?: (event: BrowserStreamEvent) => void

  constructor(private readonly connect: (options: BrowserStreamOptions) => Promise<BrowserStream>) {}

  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.opening) this.opening = this.connect({ identity: { pairedDeviceId: this.pairedDeviceId, clientKind: 'mobile' }, onEvent: event => this.event(event), onClose: () => this.close() }).then(stream => this.stream = stream).catch(error => { this.opening = undefined; throw error })
    return (await this.opening).call(method, params)
  }

  attachViewer(viewer: (event: BrowserStreamEvent) => void): () => void {
    this.viewer?.({ method: 'browser.screencast', params: { type: 'end' } })
    this.viewer = viewer
    return () => { if (this.viewer === viewer) this.close() }
  }

  async observe(): Promise<Record<string, unknown>> {
    const target = this.target
    if (!target) throw new JavisError('stale_snapshot', 'Select a browser page before observing')
    this.requiresRefresh = true
    const params = { page: target.page, worktree: target.worktree }
    const snapshot = await this.call('browser.snapshot', params)
    const measured = await this.call('browser.eval', { ...params, expression: 'JSON.stringify({url:location.href,width:innerWidth,height:innerHeight})' })
    const outer = measured as { result?: unknown; value?: unknown }
    let geometry: any = outer?.result ?? outer?.value ?? measured
    if (typeof geometry === 'string') geometry = JSON.parse(geometry)
    if (!geometry || typeof geometry.url !== 'string' || !Number.isFinite(geometry.width) || !Number.isFinite(geometry.height) || geometry.width <= 0 || geometry.height <= 0) throw new JavisError('transport_error', 'Browser observation did not return current geometry')
    if (this.target !== target) throw new JavisError('stale_snapshot', 'Browser selection changed during observation')
    this.target = { ...target, url: geometry.url, width: geometry.width, height: geometry.height, observedAt: Date.now() }
    this.requiresRefresh = false
    return { snapshot, target: this.target }
  }

  async act(method: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const target = this.target
    if (!target || this.requiresRefresh || Date.now() - target.observedAt > 120_000) throw new JavisError('stale_snapshot', 'Refresh before acting')
    const keys = actions[method]
    if (!keys || Object.keys(input).some(key => !keys.includes(key))) throw new JavisError('invalid_argument', 'Invalid mobile browser action')
    if (['browser.mouseMove', 'browser.mouseClick'].includes(method) && (typeof input.x !== 'number' || typeof input.y !== 'number' || !Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0 || input.x >= target.width || input.y >= target.height)) throw new JavisError('invalid_argument', 'Browser coordinates are outside observed geometry')
    this.requiresRefresh = true
    const action = await this.call(method, { ...input, page: target.page, worktree: target.worktree, expectUrl: target.url })
    try { return { action, verification: 'observed', ...await this.observe() } }
    catch { return { action, verification: 'unavailable', observationError: { code: 'stale_snapshot', message: 'Refresh before acting again' } } }
  }

  async startStream(params: Record<string, unknown>): Promise<unknown> {
    if (!this.target) throw new JavisError('stale_snapshot', 'Select a browser page first')
    if (this.subscriptionId) await this.call('browser.screencast.unsubscribe', { subscriptionId: this.subscriptionId })
    this.subscriptionId = null; this.frameSeq = null
    const ready = await this.call('browser.screencast', { page: this.target.page, worktree: this.target.worktree, format: 'jpeg', quality: 70, maxWidth: 3840, maxHeight: 2160, viewportWidth: params.width, viewportHeight: params.height, deviceScaleFactor: params.deviceScaleFactor, mobile: true, frameAck: 1 }) as Record<string, unknown>
    this.subscriptionId = String(ready.subscriptionId)
    return ready
  }

  async ack(seq: number): Promise<unknown> {
    if (!this.subscriptionId || !Number.isSafeInteger(seq) || seq < 0 || this.frameSeq === null || seq > this.frameSeq) throw new JavisError('invalid_argument', 'Frame acknowledgement is outside delivered frames')
    return this.call('browser.screencast.ack', { subscriptionId: this.subscriptionId, seq })
  }

  close(): void {
    const stream = this.stream
    this.stream = undefined; this.opening = undefined
    this.subscriptionId = null; this.frameSeq = null; this.requiresRefresh = true
    stream?.close()
    const viewer = this.viewer; this.viewer = undefined
    viewer?.({ method: 'browser.screencast', params: { type: 'end' } })
  }

  private event(event: BrowserStreamEvent): void {
    if (event.method === 'browser.stream.binary') {
      if (event.params.method !== 'browser.screencast' || typeof event.params.bytes !== 'string') return
      const frame = decodeBrowserScreencastFrame(Buffer.from(event.params.bytes, 'base64'))
      if (!frame) { this.close(); return }
      this.frameSeq = frame.seq
    } else if (event.method === 'browser.screencast') {
      if (event.params.type === 'ready' && typeof event.params.subscriptionId === 'string') this.subscriptionId = event.params.subscriptionId
      if (event.params.type === 'error' || event.params.type === 'end') this.requiresRefresh = true
    }
    this.viewer?.(event)
  }
}
