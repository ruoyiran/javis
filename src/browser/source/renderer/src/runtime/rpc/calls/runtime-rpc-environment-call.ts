import { isJavisBrowserTransport, invokeJavisBrowser } from '../compatibility/javis-browser-compatibility'
import { callAbortableRuntimeEnvironment } from './abortable-runtime-environment-call'
import { observePairingRefusal } from '../environment-revisions/runtime-environment-pairing-refresh'

export function callRuntimeEnvironmentWithRevision(
  args: Parameters<typeof callRuntimeEnvironmentOnce>[0]
): Promise<unknown> {
  return observePairingRefusal(callRuntimeEnvironmentOnce(args))
}

async function callRuntimeEnvironmentOnce(args: {
  environmentId: string
  method: string
  params: unknown
  timeoutMs?: number
  signal?: AbortSignal
  expectedEnvironmentPairingRevision?: number
  expectedEnvironmentRuntimeId?: string
}): Promise<unknown> {
  if (isJavisBrowserTransport()) {
    if (args.signal?.aborted) throw new Error('Browser request canceled before delivery')
    return invokeJavisBrowser(
      args.environmentId,
      args.method,
      args.params,
      args.timeoutMs,
      args.expectedEnvironmentPairingRevision
    )
  }
  if (args.signal) {
    return callAbortableRuntimeEnvironment(
      args.environmentId,
      args.method,
      args.params,
      args.timeoutMs,
      args.signal,
      args.expectedEnvironmentPairingRevision,
      args.expectedEnvironmentRuntimeId
    )
  }
  return window.api.runtimeEnvironments.call({
    selector: args.environmentId,
    method: args.method,
    params: args.params,
    timeoutMs: args.timeoutMs,
    expectedEnvironmentPairingRevision: args.expectedEnvironmentPairingRevision,
    expectedEnvironmentRuntimeId: args.expectedEnvironmentRuntimeId
  })
}
