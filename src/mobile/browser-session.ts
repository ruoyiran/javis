import { randomUUID } from 'node:crypto'
import type { BrowserStream, BrowserStreamEvent, BrowserStreamOptions, BrowserEventAdmission } from '../browser/remote/framed-channel.js'
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
  private viewer?: (event: BrowserStreamEvent) => BrowserEventAdmission | void
  private generation = 0
  private streamGeneration = 0
  private streamPage?: string
  private frameGeometry?: { width?: number; height?: number }

  constructor(private readonly connect: (options: BrowserStreamOptions) => Promise<BrowserStream>) {}

  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const generation = this.generation
    if (!this.opening) {
      this.opening = this.connect({ identity: { pairedDeviceId: this.pairedDeviceId, clientKind: 'mobile' },
        onEvent: event => generation === this.generation ? this.event(event) : { outcome: false },
        onClose: () => { if (generation === this.generation) this.close() }
      }).then(stream => {
        if (generation !== this.generation) { stream.close(); throw new JavisError('transport_error', 'Browser session closed before delivery') }
        return this.stream = stream
      }).catch(error => { if (generation === this.generation) this.opening = undefined; throw error })
    }
    const stream = await this.opening
    if (generation !== this.generation) throw new JavisError('transport_error', 'Browser session closed before delivery')
    return stream.call(method, params)
  }

  async select(target: MobileBrowserTarget): Promise<void> {
    const subscriptionId = this.subscriptionId
    this.streamGeneration++; this.subscriptionId = null; this.frameSeq = null; this.frameGeometry = undefined; this.streamPage = undefined
    this.target = target; this.requiresRefresh = true
    if (subscriptionId) await this.call('browser.screencast.unsubscribe', { subscriptionId })
  }

  setBacklogged(backlogged: boolean): void { this.stream?.setBacklogged?.(backlogged) }

  attachViewer(viewer: (event: BrowserStreamEvent) => BrowserEventAdmission | void): () => void {
    this.viewer?.({ method: 'browser.screencast', params: { type: 'end' } })
    this.viewer = viewer
    return () => { if (this.viewer === viewer) this.close() }
  }

  async observe(): Promise<Record<string, unknown>> {
    const generation = this.generation
    const streamGeneration = this.streamGeneration
    const target = this.target
    if (!target) throw new JavisError('stale_snapshot', 'Select a browser page before observing')
    this.requiresRefresh = true
    const params = { page: target.page, worktree: target.worktree }
    const snapshot = await this.call('browser.snapshot', params)
    if (generation !== this.generation || streamGeneration !== this.streamGeneration || this.target !== target) throw new JavisError('stale_snapshot', 'Browser observation was cancelled')
    const measured = await this.call('browser.eval', { ...params, expression: 'JSON.stringify({url:location.href,width:innerWidth,height:innerHeight})' })
    const outer = measured as { result?: unknown; value?: unknown }
    let geometry: any = outer?.result ?? outer?.value ?? measured
    if (typeof geometry === 'string') geometry = JSON.parse(geometry)
    if (!geometry || typeof geometry.url !== 'string' || !Number.isFinite(geometry.width) || !Number.isFinite(geometry.height) || geometry.width <= 0 || geometry.height <= 0) throw new JavisError('transport_error', 'Browser observation did not return current geometry')
    if (generation !== this.generation || streamGeneration !== this.streamGeneration || this.target !== target) throw new JavisError('stale_snapshot', 'Browser selection changed during observation')
    if (this.frameGeometry && ((this.frameGeometry.width !== undefined && this.frameGeometry.width !== geometry.width) || (this.frameGeometry.height !== undefined && this.frameGeometry.height !== geometry.height))) throw new JavisError('stale_snapshot', 'Browser geometry changed during observation')
    this.target = { ...target, url: geometry.url, width: geometry.width, height: geometry.height, observedAt: Date.now() }
    this.requiresRefresh = false
    return { snapshot, target: this.target }
  }

  async act(method: string, input: Record<string, unknown>, displayedFrame?: { subscriptionId: string; seq: number }): Promise<Record<string, unknown>> {
    const generation = this.generation
    const target = this.target
    if (!target || this.requiresRefresh || Date.now() - target.observedAt > 120_000) throw new JavisError('stale_snapshot', 'Refresh before acting')
    const keys = actions[method]
    if (!keys || Object.keys(input).some(key => !keys.includes(key))) throw new JavisError('invalid_argument', 'Invalid mobile browser action')
    if (['browser.mouseMove', 'browser.mouseClick'].includes(method) && (typeof input.x !== 'number' || typeof input.y !== 'number' || !Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.y < 0 || input.x >= target.width || input.y >= target.height)) throw new JavisError('invalid_argument', 'Browser coordinates are outside observed geometry')
    if (['browser.mouseMove', 'browser.mouseClick'].includes(method) && (!displayedFrame || displayedFrame.subscriptionId !== this.subscriptionId || displayedFrame.seq !== this.frameSeq || this.streamPage !== target.page)) throw new JavisError('stale_snapshot', 'Refresh the displayed browser frame before acting')
    const pages = await this.call('browser.tabList', { worktree: target.worktree }) as { tabs?: { browserPageId: string; profileId?: string }[] }
    const page = pages.tabs?.find(page => page.browserPageId === target.page)
    if (!page || (target.profileId !== undefined && page.profileId !== target.profileId)) { this.requiresRefresh = true; throw new JavisError('stale_snapshot', 'Browser page profile or ownership changed; select it again') }
    if (this.requiresRefresh || this.target !== target) throw new JavisError('stale_snapshot', 'Refresh before acting')
    this.requiresRefresh = true
    const action = await this.call(method, { ...input, page: target.page, worktree: target.worktree, expectUrl: target.url })
    try { if (generation !== this.generation) throw new JavisError('stale_snapshot', 'Browser action observation was cancelled'); return { action, verification: 'observed', ...await this.observe() } }
    catch { return { action, verification: 'unavailable', observationError: { code: 'stale_snapshot', message: 'Refresh before acting again' } } }
  }

  async startStream(params: Record<string, unknown>): Promise<unknown> {
    const generation = this.generation
    const streamGeneration = ++this.streamGeneration
    const target = this.target
    this.requiresRefresh = true
    if (!target) throw new JavisError('stale_snapshot', 'Select a browser page first')
    if (this.subscriptionId) await this.call('browser.screencast.unsubscribe', { subscriptionId: this.subscriptionId })
    this.subscriptionId = null; this.frameSeq = null; this.streamPage = target.page; this.frameGeometry = undefined
    const ready = await this.call('browser.screencast', { page: target.page, worktree: target.worktree, format: 'jpeg', quality: 70, maxWidth: 3840, maxHeight: 2160, viewportWidth: params.width, viewportHeight: params.height, deviceScaleFactor: params.deviceScaleFactor, mobile: true, frameAck: 1 }) as Record<string, unknown>
    if (generation !== this.generation || streamGeneration !== this.streamGeneration || this.target !== target) throw new JavisError('stale_snapshot', 'Browser stream selection changed')
    this.subscriptionId = String(ready.subscriptionId)
    return ready
  }

  async ack(seq: number): Promise<unknown> {
    if (!this.subscriptionId || !Number.isSafeInteger(seq) || seq < 0 || this.frameSeq === null || seq > this.frameSeq) throw new JavisError('invalid_argument', 'Frame acknowledgement is outside delivered frames')
    return this.call('browser.screencast.ack', { subscriptionId: this.subscriptionId, seq })
  }

  close(): void {
    this.generation++; this.streamGeneration++; this.streamPage = undefined; this.frameGeometry = undefined
    const stream = this.stream
    this.stream = undefined; this.opening = undefined
    this.subscriptionId = null; this.frameSeq = null; this.requiresRefresh = true
    stream?.close()
    const viewer = this.viewer; this.viewer = undefined
    viewer?.({ method: 'browser.screencast', params: { type: 'end' } })
  }

  private event(event: BrowserStreamEvent): BrowserEventAdmission | void {
    if (event.method === 'browser.stream.binary') {
      if (event.params.method !== 'browser.screencast' || typeof event.params.bytes !== 'string') return
      if (!this.subscriptionId || event.params.subscriptionId !== this.subscriptionId || this.streamPage !== this.target?.page) return { outcome: false }
      const frame = decodeBrowserScreencastFrame(Buffer.from(event.params.bytes, 'base64'))
      if (!frame) { this.close(); return }
      this.frameSeq = frame.seq
      const { deviceWidth, deviceHeight } = frame.metadata
      this.frameGeometry = { width: deviceWidth, height: deviceHeight }
      if (this.target && ((deviceWidth !== undefined && deviceWidth !== this.target.width) || (deviceHeight !== undefined && deviceHeight !== this.target.height))) this.requiresRefresh = true
    } else if (event.method === 'browser.screencast') {
      if (event.params.type === 'ready' && event.params.browserPageId === this.target?.page && typeof event.params.subscriptionId === 'string') this.subscriptionId = event.params.subscriptionId
      if (event.params.type === 'error' || event.params.type === 'end') this.requiresRefresh = true
    }
    return this.viewer?.({ ...event, params: { ...event.params, page: this.streamPage, streamGeneration: this.streamGeneration } })
  }
}
