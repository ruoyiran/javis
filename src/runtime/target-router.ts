import { JavisError } from './error.js'
import { callJavis } from './public.js'
import { callRemoteJavis } from './remote-stdio.js'
import type { BrowserDaemonMethod } from './daemon-dispatch.js'
import type { JavisMethod } from './session.js'
import type { ComputerReadOptions } from './computer-read-options.js'
export type JavisCallOptions = ComputerReadOptions

export type JavisTarget = { host?: string; context?: string }

export async function callTarget(
  method: JavisMethod | BrowserDaemonMethod,
  params: Record<string, unknown>,
  target: JavisTarget = {},
  options: JavisCallOptions = {}
): Promise<unknown> {
  if (target.context !== undefined && !target.context) {
    throw new JavisError('invalid_argument', 'context must be a non-empty string')
  }
  const routedParams = target.context === undefined ? params : { ...params, worktree: target.context }
  if (target.host === undefined) return Object.keys(options).length ? callJavis(method, routedParams, options) : callJavis(method, routedParams)
  return Object.keys(options).length ? callRemoteJavis(method, routedParams, target.host, options) : callRemoteJavis(method, routedParams, target.host)
}
