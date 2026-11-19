import { randomBytes, timingSafeEqual } from 'node:crypto'
import { DeviceSession } from './device-session.js'

const fiveMinutes = 300_000
const deviceLifetime = 8 * 60 * 60_000
const randomToken = (bytes: number) => randomBytes(bytes).toString('hex')

type PrePair = { csrfToken: string; expiresAt: number }

export class MobilePairing {
  readonly pairingCode = randomToken(16)
  private pairingExpiresAt = Date.now() + fiveMinutes
  private available = true
  private prePair = new Map<string, PrePair>()
  private devices = new Map<string, DeviceSession>()
  private failedAttempts = new Map<string, { count: number; since: number }>()

  issueToken(): { cookie: string; csrfToken: string } {
    this.purge()
    const cookie = randomToken(32)
    const csrfToken = randomToken(32)
    this.prePair.set(cookie, { csrfToken, expiresAt: Date.now() + fiveMinutes })
    return { cookie, csrfToken }
  }

  pair(code: unknown, prePairCookie: string | undefined, csrfToken: string | undefined, address: string): { cookie: string; device: DeviceSession } | null {
    this.purge()
    const attempts = this.failedAttempts.get(address)
    if (attempts && attempts.count >= 5 && Date.now() - attempts.since < 60_000) return null
    const prePair = prePairCookie ? this.prePair.get(prePairCookie) : undefined
    if (!prePair || !csrfToken || !equal(csrfToken, prePair.csrfToken)) return null
    if (!this.available || Date.now() >= this.pairingExpiresAt || typeof code !== 'string' || !equal(code, this.pairingCode)) {
      const current = attempts && Date.now() - attempts.since < 60_000 ? attempts : { count: 0, since: Date.now() }
      current.count++
      this.failedAttempts.set(address, current)
      return null
    }
    this.available = false
    this.prePair.delete(prePairCookie as string)
    const cookie = randomToken(32)
    const device = new DeviceSession(randomToken(32))
    this.devices.set(cookie, device)
    return { cookie, device }
  }

  device(cookie: string | undefined): DeviceSession | null {
    this.purge()
    if (!cookie) return null
    const device = this.devices.get(cookie)
    if (!device) return null
    device.lastSeen = Date.now()
    return device
  }

  close(): void { for (const device of this.devices.values()) device.browser?.close(); this.devices.clear() }

  private purge(): void {
    const now = Date.now()
    for (const [cookie, token] of this.prePair) if (token.expiresAt <= now) this.prePair.delete(cookie)
    for (const [cookie, device] of this.devices) if (now - device.lastSeen >= deviceLifetime) { device.browser?.close(); this.devices.delete(cookie) }
    for (const [address, attempt] of this.failedAttempts) if (now - attempt.since >= 60_000) this.failedAttempts.delete(address)
  }
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
