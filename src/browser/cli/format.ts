import { AsyncLocalStorage } from 'node:async_hooks'
import type { RuntimeRpcSuccess } from '../source/shared/runtime-rpc-envelope.js'
import { formatBrowserActionEffects } from './browser-format.js'
export type BrowserOutput = ((text: string) => unknown) | { write(text: string): unknown }
export const browserOutput = new AsyncLocalStorage<BrowserOutput>()
export function writeBrowserOutput(output: BrowserOutput, text: string): void {
  if (typeof output === 'function') output(text)
  else output.write(text)
}
export function printResult<T>(response: RuntimeRpcSuccess<T>, json: boolean, formatter: (value: T) => string): void {
  const text = json ? JSON.stringify({ ok: true, result: response.result }, null, 2) : formatter(response.result) + formatBrowserActionEffects(response.result)
  writeBrowserOutput(browserOutput.getStore() ?? process.stdout, text + '\n')
}
