import { JavisError } from './error.js'
import type { JavisMethod } from './session.js'

/** Validate the shared target before starting a provider or delivering input. */
export function validateComputerRequestParams(method: JavisMethod, params: Record<string, unknown>): void {
  if (method === 'capabilities' || method === 'listApps' || method === 'listWindows') {
    const allowed = method === 'listWindows' ? ['app'] : []
    if (Object.keys(params).some(key => !allowed.includes(key))) {
      throw new JavisError('invalid_argument', `${method} received an unsupported parameter`)
    }
    if (method !== 'listWindows') return
  }
  if (typeof params.app !== 'string' || !params.app) {
    throw new JavisError('invalid_argument', 'app must be a non-empty string')
  }
  if (params.windowId !== undefined && params.windowIndex !== undefined) {
    throw new JavisError('invalid_argument', 'Window targeting accepts either windowId or windowIndex, not both')
  }
  for (const key of ['windowId', 'windowIndex'] as const) {
    const candidate = params[key]
    if (candidate !== undefined && (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0)) {
      throw new JavisError('invalid_argument', `${key} must be a non-negative integer`)
    }
  }
  for (const key of ['noScreenshot', 'restoreWindow', 'treeDiff'] as const) {
    if (params[key] !== undefined && typeof params[key] !== 'boolean') {
      throw new JavisError('invalid_argument', `${key} must be a boolean`)
    }
  }
}
