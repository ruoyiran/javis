import { unwrapRuntimeRpcResult } from '../calls/runtime-rpc-result'
import type { RuntimeRpcResponse } from '../../../../../shared/runtime-rpc-envelope'
type BrowserInvoke = (
  args: Parameters<typeof window.api.runtimeEnvironments.call>[0]
) => Promise<unknown>

export function isJavisBrowserTransport(): boolean {
  return typeof window !== 'undefined' &&
    Boolean((window.api as unknown as { javisBrowser?: unknown }).javisBrowser)
}

export async function invokeJavisBrowser(
  selector: string,
  method: string,
  params: unknown,
  timeoutMs?: number,
  expectedEnvironmentPairingRevision?: number
): Promise<unknown> {
  const api = window.api.runtimeEnvironments as unknown as { invoke: BrowserInvoke }
  return api.invoke({ selector, method, params, timeoutMs, expectedEnvironmentPairingRevision })
}

export function unwrapJavisBrowserResponse(response: unknown): unknown {
  if (response && typeof response === 'object' && 'ok' in response) {
    return unwrapRuntimeRpcResult(response as RuntimeRpcResponse<unknown>)
  }
  return response
}
export async function verifyJavisBrowserHost(
  selector: string,
  timeoutMs?: number,
  expectedEnvironmentPairingRevision?: number
): Promise<void> {
  const status = unwrapJavisBrowserResponse(
    await invokeJavisBrowser(selector, 'browser.status', {}, timeoutMs, expectedEnvironmentPairingRevision)
  )
  if (
    !status || typeof status !== 'object' || !('running' in status) || status.running !== true ||
    !('protocolVersion' in status) || status.protocolVersion !== 1
  ) {
    throw new Error('The Javis browser host is unavailable or incompatible')
  }
}
