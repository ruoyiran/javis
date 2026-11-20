import {
  isJavisBrowserTransport,
  verifyJavisBrowserHost,
  invokeJavisBrowser,
  unwrapJavisBrowserResponse
} from '../compatibility/javis-browser-compatibility'
import { waitForPromiseWithSignal } from '../../../../../shared/abort-signal-reason'
import type {
  RuntimeRpcResponse,
  RuntimeRpcSuccess
} from '../../../../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../../../../shared/runtime-session-contracts'
import { withBrowserPaneUiRuntimeRpcSource } from '../../../../../shared/runtime-rpc-feature-interaction-source'
import { createRuntimeRpcAbortError } from './abortable-runtime-environment-call'
import { callRuntimeEnvironmentWithRevision } from './runtime-rpc-environment-call'
import { RuntimeRpcCallError } from './runtime-rpc-result'
import { captureRuntimeEnvironmentRequestRevision } from '../environment-revisions/runtime-environment-revision'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { ensureRuntimeEnvironmentCompatible } from '../compatibility/runtime-compatibility-probe'

type RuntimeRpcCallOptions = {
  timeoutMs?: number
  suppressFeatureInteraction?: boolean
  reuseRecentCompatibilityFailure?: boolean
  skipCompatibilityCheck?: boolean
  signal?: AbortSignal
  expectedEnvironmentPairingRevision?: number
  expectedEnvironmentRuntimeId?: string
  beforeSend?: () => void
  paramsForStatus?: (status: RuntimeStatus | null) => unknown
}

export async function callRuntimeRpc<TResult>(
  target: RuntimeClientTarget,
  method: string,
  params?: unknown,
  options: RuntimeRpcCallOptions = {}
): Promise<TResult> {
  return (await callRuntimeRpcResponse<TResult>(target, method, params, options)).result
}

export async function callRuntimeRpcResponse<TResult>(
  target: RuntimeClientTarget,
  method: string,
  params?: unknown,
  options: RuntimeRpcCallOptions = {}
): Promise<Pick<RuntimeRpcSuccess<TResult>, 'ok' | 'result'>> {
  if (options.signal?.aborted) {
    throw createRuntimeRpcAbortError()
  }
  const expectedEnvironmentPairingRevision =
    target.kind === 'environment'
      ? captureRuntimeEnvironmentRequestRevision(
          target.environmentId,
          options.expectedEnvironmentPairingRevision
        )
      : undefined
  if (isJavisBrowserTransport()) {
    if (!method.startsWith('browser.')) {
      throw new Error('This Javis transport owns browser methods only')
    }
    const selector = target.kind === 'local' ? 'local' : target.environmentId
    if (
      target.kind === 'environment' &&
      method !== 'browser.status' &&
      !options.skipCompatibilityCheck
    ) {
      await waitForPromiseWithSignal(
        verifyJavisBrowserHost(selector, options.timeoutMs, expectedEnvironmentPairingRevision),
        options.signal
      )
    }
    if (options.signal?.aborted) throw createRuntimeRpcAbortError()
    const selected = options.paramsForStatus ? options.paramsForStatus(null) : params
    const nextParams = options.suppressFeatureInteraction
      ? withBrowserPaneUiRuntimeRpcSource(selected)
      : selected
    options.beforeSend?.()
    const response = await waitForPromiseWithSignal(
      invokeJavisBrowser(
        selector,
        method,
        nextParams,
        options.timeoutMs,
        expectedEnvironmentPairingRevision
      ),
      options.signal
    )
    const result = unwrapJavisBrowserResponse(response) as TResult
    return response && typeof response === 'object' && 'ok' in response
      ? { ...response, ok: true, result }
      : { ok: true, result }
  }
  const compatibilityStatus =
    target.kind === 'environment' &&
    method !== 'status.get' &&
    options.skipCompatibilityCheck !== true
      ? await waitForPromiseWithSignal(
          ensureRuntimeEnvironmentCompatible(target.environmentId, {
            ...options,
            expectedEnvironmentPairingRevision
          }),
          options.signal
        )
      : null
  if (options.signal?.aborted) {
    throw createRuntimeRpcAbortError()
  }
  const selectedParams = options.paramsForStatus
    ? options.paramsForStatus(compatibilityStatus)
    : params
  const nextParams = options.suppressFeatureInteraction
    ? withBrowserPaneUiRuntimeRpcSource(selectedParams)
    : selectedParams
  options.beforeSend?.()
  const response =
    target.kind === 'local'
      ? await window.api.runtime.call({ method, params: nextParams })
      : await callRuntimeEnvironmentWithRevision({
          environmentId: target.environmentId,
          method,
          params: nextParams,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
          expectedEnvironmentPairingRevision,
          expectedEnvironmentRuntimeId:
            options.expectedEnvironmentRuntimeId ??
            (options.paramsForStatus ? compatibilityStatus?.runtimeId : undefined)
        })
  const envelope = response as RuntimeRpcResponse<TResult>
  if (!envelope.ok) {
    throw new RuntimeRpcCallError(envelope)
  }
  return envelope
}
