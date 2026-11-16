import { timingSafeEqual } from 'node:crypto'
import { JavisError } from './error.js'
import type { JavisDaemonMethod } from './daemon-dispatch.js'

const methods = new Set<string>([
  'capabilities', 'listApps', 'listWindows', 'getAppState', 'click',
  'performSecondaryAction', 'scroll', 'drag', 'typeText', 'pressKey',
  'hotkey', 'pasteText', 'setValue', 'permissionsStatus', 'permissionsOpen', 'permissionsReset', '__shutdown'
])

export type DaemonRequest = { id: number; method: JavisDaemonMethod | '__shutdown'; params: Record<string, unknown> }

export function parseDaemonRequest(line: string, token: string): DaemonRequest {
  let value: unknown
  try { value = JSON.parse(line) }
  catch { throw new JavisError('invalid_argument', 'Invalid request JSON') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JavisError('invalid_argument', 'Invalid request object')
  }
  const input = value as Record<string, unknown>
  if (!Number.isSafeInteger(input.id) || (input.id as number) < 1 || typeof input.method !== 'string' || !methods.has(input.method)) {
    throw new JavisError('invalid_argument', 'Invalid request method or ID')
  }
  if (typeof input.token !== 'string') throw new JavisError('access_denied', 'Invalid Javis daemon token')
  const supplied = Buffer.from(input.token)
  const expected = Buffer.from(token)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new JavisError('access_denied', 'Invalid Javis daemon token')
  }
  if (input.params === undefined && input.method === '__shutdown') {
    return { id: input.id as number, method: '__shutdown', params: {} }
  }
  if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) {
    throw new JavisError('invalid_argument', 'Invalid request parameters')
  }
  return { id: input.id as number, method: input.method as JavisDaemonMethod, params: input.params as Record<string, unknown> }
}
