import type { ComputerScreenshotData } from '../contract/computer-use-runtime-types.js'

export type DeviceTarget = {
  app: string
  windowId?: number
  windowIndex?: number
  sessionId: string
  observedAt: number
  screenshot: Pick<ComputerScreenshotData, 'width' | 'height' | 'scale'> | null
}

export class DeviceSession {
  target: DeviceTarget | null = null
  requiresRefresh = true
  readonly csrfToken: string
  lastSeen = Date.now()
  private queue: Promise<unknown> = Promise.resolve()
  private requestIds = new Set<string>()

  constructor(csrfToken: string) { this.csrfToken = csrfToken }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  acceptRequestId(id: string): boolean {
    if (this.requestIds.has(id)) return false
    this.requestIds.add(id)
    return true
  }
}
