import { isJavisBrowserTransport } from '../../rpc/compatibility/javis-browser-compatibility'
import { callRuntimeEnvironmentWithRevision } from '../../rpc/calls/runtime-rpc-environment-call'
import { runtimeEnvironmentPairingChangedError } from '../../rpc/environment-revisions/runtime-environment-pairing-refresh'
import type { RuntimeRpcResponse } from '../../../../../shared/runtime-rpc-envelope'
import { getRuntimeEnvironmentRevision } from '../../rpc/environment-revisions/runtime-environment-revision'
import type { WebSessionIntentOwner } from './web-session-intent-owner'

export function isWebRuntimeSessionActive(
  activeRuntimeEnvironmentId: string | null | undefined
): boolean {
  // Why: headless serve sessions are owned by the remote runtime, whether the client is web or desktop Electron.
  return Boolean(activeRuntimeEnvironmentId?.trim())
}

export function captureRuntimeEnvironmentCall(
  environmentId: string,
  expectedEnvironmentPairingRevision = getRuntimeEnvironmentRevision(environmentId)
): (args: {
  method: string
  params?: unknown
  timeoutMs?: number
}) => Promise<RuntimeRpcResponse<unknown>> {
  return async (args) => {
    const javis = isJavisBrowserTransport()
    const method =
      javis && args.method === 'session.tabs.list' ? 'browser.workspaceSnapshot' : args.method
    if (javis) {
      if (!method.startsWith('browser.'))
        throw new Error('This Javis transport owns browser methods only')
      if (getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentPairingRevision) {
        throw runtimeEnvironmentPairingChangedError()
      }
    }
    return (await callRuntimeEnvironmentWithRevision({
      environmentId,
      method,
      params: args.params,
      timeoutMs: args.timeoutMs,
      expectedEnvironmentPairingRevision
    })) as RuntimeRpcResponse<unknown>
  }
}

export function captureWebSessionIntentOwner(environmentId: string): WebSessionIntentOwner {
  return {
    environmentId,
    pairingRevision: getRuntimeEnvironmentRevision(environmentId)
  }
}

export function matchesWebSessionIntentOwner(owner: WebSessionIntentOwner): boolean {
  return getRuntimeEnvironmentRevision(owner.environmentId) === owner.pairingRevision
}
