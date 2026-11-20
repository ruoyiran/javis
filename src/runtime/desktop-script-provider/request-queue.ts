import { JavisError } from '../error.js'

/** Bound queue waiting separately so started operations retain their full execution timeout. */
export class DesktopScriptRequestQueue {
  /** Swallow predecessor failures so they cannot reject later requests. */
  private tail: Promise<void> | null = null

  constructor(
    private readonly waitTimeoutMs: number,
    private readonly onDrained: () => void
  ) {}

  enqueue<T>(run: () => Promise<T>, waitTimeoutMs = this.waitTimeoutMs): Promise<T> {
    const queued = this.tail
    if (!queued) {
      return this.track(run())
    }
    let expiry: JavisError | null = null
    let waitTimer: NodeJS.Timeout | undefined
    const waited = new Promise<never>((_resolve, reject) => {
      waitTimer = setTimeout(() => {
        expiry = new JavisError(
          'action_timeout',
          `desktop provider timed out after ${waitTimeoutMs}ms waiting for earlier operations`
        )
        reject(expiry)
      }, waitTimeoutMs)
      waitTimer.unref?.()
    })
    // Expired requests must never deliver input after the caller was told they failed.
    const turn = (): Promise<T> => {
      clearTimeout(waitTimer)
      return expiry ? Promise.reject(expiry) : run()
    }
    // Caller timeout must not release the next turn while its predecessor is still running.
    return Promise.race([waited, this.track(queued.then(turn, turn))])
  }

  private track<T>(result: Promise<T>): Promise<T> {
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.tail = tail
    void tail.finally(() => {
      if (this.tail !== tail) {
        return
      }
      this.tail = null
      this.onDrained()
    })
    return result
  }
}
