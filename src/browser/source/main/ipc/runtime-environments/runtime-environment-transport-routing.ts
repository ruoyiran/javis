export type BrowserHostTransport = (target: string, method: string, params: unknown, timeoutMs?: number) => Promise<any>
let transport: BrowserHostTransport | null = null
export function setBrowserHostTransport(next: BrowserHostTransport): void { transport = next }
export function callRuntimeEnvironment(_dataDirectory: string, target: string, method: string, params: unknown, timeoutMs?: number): Promise<any> {
  if (!transport) throw new Error('browser_host_transport_unavailable')
  return transport(target, method, params, timeoutMs)
}
export async function subscribeRuntimeEnvironment(_dataDirectory: string, target: string, method: string, params: unknown): Promise<any> {
  return callRuntimeEnvironment(_dataDirectory, target, method, params)
}
