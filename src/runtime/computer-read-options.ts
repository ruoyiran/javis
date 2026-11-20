import { JavisError } from './error.js'

export type ComputerReadOptions = {
  timeoutMs?: number
  observation?: { mode: 'stage' | 'publish'; token: string }
}
export type ProviderReadOptions = { deadline?: number }

export function isComputerRead(method: string, params: Record<string, unknown>): boolean {
  return ['capabilities', 'handshake', 'listApps', 'listWindows', 'getAppState'].includes(method) && params.restoreWindow !== true
}

export function validateComputerReadOptions(method: string, params: Record<string, unknown>, options: ComputerReadOptions): void {
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || isComputerRead(method, params) && options.timeoutMs > 120_000)) {
    throw new JavisError('invalid_argument', 'Read timeoutMs must be a positive integer at most 120000 ms')
  }
  const observation = options.observation
  if (observation !== undefined && (method !== 'getAppState' || params.restoreWindow === true || !observation || !['stage', 'publish'].includes(observation.mode) || typeof observation.token !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(observation.token))) {
    throw new JavisError('invalid_argument', 'Invalid provisional observation options')
  }
}

export function computerReadEnvelope(method: string, params: Record<string, unknown>, options: ComputerReadOptions): ComputerReadOptions {
  validateComputerReadOptions(method, params, options)
  return { ...(isComputerRead(method, params) && options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}), ...(options.observation ? { observation: options.observation } : {}) }
}

export function providerReadTimeout(method: string, params: Record<string, unknown>, options: ProviderReadOptions, fallback: number): number {
  if (!isComputerRead(method, params) || options.deadline === undefined) return fallback
  const remaining = options.deadline - Date.now()
  if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 120_000) throw new JavisError('action_timeout', 'Read deadline expired before provider delivery')
  return remaining
}
