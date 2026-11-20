import { JavisError } from './error.js'
import type { JavisMethod } from './session.js'

/** Validate the shared target before starting a provider or delivering input. */
export function validateComputerRequestParams(method: JavisMethod, params: Record<string, unknown>): void {
  if (method === 'launchApp') {
    if (Object.keys(params).some(key => !['app', 'activate'].includes(key)) || typeof params.app !== 'string' || !params.app || (params.activate !== undefined && typeof params.activate !== 'boolean')) {
      throw new JavisError('invalid_argument', 'launchApp requires an app and optional boolean activate')
    }
    return
  }
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
  for (const key of ['windowId', 'windowIndex', 'rootElementIndex'] as const) {
    const candidate = params[key]
    if (candidate !== undefined && (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0)) {
      throw new JavisError('invalid_argument', `${key} must be a non-negative integer`)
    }
  }
  for (const key of ['noScreenshot', 'restoreWindow', 'treeDiff', 'allowSystemShortcut'] as const) {
    if (params[key] !== undefined && typeof params[key] !== 'boolean') {
      throw new JavisError('invalid_argument', `${key} must be a boolean`)
    }
  }
  if (params.rootElementIndex !== undefined && method !== 'getAppState') throw new JavisError('invalid_argument', 'rootElementIndex is only valid for observations')
  if (params.screenshotFormat !== undefined && params.screenshotFormat !== 'png' && params.screenshotFormat !== 'jpeg') throw new JavisError('invalid_argument', 'screenshotFormat must be png or jpeg')
  if (params.screenshotScale !== undefined && (typeof params.screenshotScale !== 'number' || !Number.isFinite(params.screenshotScale) || params.screenshotScale <= 0)) throw new JavisError('invalid_argument', 'screenshotScale must be positive and finite')
  if (params.screenshotMaxEdge !== undefined && (typeof params.screenshotMaxEdge !== 'number' || !Number.isSafeInteger(params.screenshotMaxEdge) || params.screenshotMaxEdge <= 0)) throw new JavisError('invalid_argument', 'screenshotMaxEdge must be a positive integer')
}
