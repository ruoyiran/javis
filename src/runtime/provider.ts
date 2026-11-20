import type { ProviderReadOptions } from './computer-read-options.js'
export interface JavisProvider {
  call(method: string, params: Record<string, unknown>, options?: ProviderReadOptions): Promise<unknown>
  shutdown(): Promise<void>
}
