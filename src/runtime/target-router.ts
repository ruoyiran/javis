import { JavisError } from './error.js'
import { callJavis } from './public.js'
import { callRemoteJavis } from './remote-stdio.js'
import type { JavisMethod } from './session.js'

export type JavisTarget = { host?: string; context?: string }

export async function callTarget(
  method: JavisMethod,
  params: Record<string, unknown>,
  target: JavisTarget = {}
): Promise<unknown> {
  if (target.context !== undefined && !target.context) {
    throw new JavisError('invalid_argument', 'context must be a non-empty string')
  }
  const routedParams = target.context === undefined ? params : { ...params, worktree: target.context }
  return target.host === undefined
    ? callJavis(method, routedParams)
    : callRemoteJavis(method, routedParams, target.host)
}
