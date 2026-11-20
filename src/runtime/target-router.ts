import { JavisError } from './error.js'
import { callJavis } from './public.js'
import { callRemoteJavis } from './remote-stdio.js'
import type { BrowserDaemonMethod } from './daemon-dispatch.js'
import type { JavisMethod } from './session.js'
export type JavisCallOptions = { timeoutMs?: number }

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
  if (target.host === undefined) return options.timeoutMs === undefined ? callJavis(method, routedParams) : callJavis(method, routedParams, options)
  return options.timeoutMs === undefined ? callRemoteJavis(method, routedParams, target.host) : callRemoteJavis(method, routedParams, target.host, options)
}
