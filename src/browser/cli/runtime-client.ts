import type { RuntimeRpcSuccess } from '../source/shared/runtime-rpc-envelope.js'
export { JavisError as RuntimeClientError } from '../../runtime/error.js'
export type RuntimeClient = {
  isRemote: boolean
  call<T>(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<RuntimeRpcSuccess<T>>
}
