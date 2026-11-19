import { JavisError } from '../../runtime/error.js'
import { browserMethodSchemas } from './catalog.js'
export { browserMethodSchemas }
export type BrowserMethod = keyof typeof browserMethodSchemas
export type BrowserCallParams = Record<string, unknown>
export type BrowserTarget = { host?: string; context?: string }
export type BrowserCall = (method: string, params: BrowserCallParams, target?: BrowserTarget) => Promise<unknown>
export const browserMethods: readonly BrowserMethod[] = Object.keys(browserMethodSchemas) as BrowserMethod[]
export const internalBrowserMethods: readonly BrowserMethod[] = browserMethods.filter(method => method.startsWith('browser.clientHost.') || method === 'browser.screencast' || method.startsWith('browser.screencast.'))
export const publicBrowserMethods: readonly BrowserMethod[] = browserMethods.filter(method => !internalBrowserMethods.includes(method))
export function validateBrowserParams(method: string, params: unknown): Record<string, unknown> {
  if (!Object.hasOwn(browserMethodSchemas, method)) throw new JavisError('invalid_argument', 'Unknown browser method')
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new JavisError('invalid_argument', 'Browser parameters must be an object')
  const parsed = browserMethodSchemas[method as BrowserMethod].safeParse(params)
  if (!parsed.success) throw new JavisError('invalid_argument', parsed.error.issues[0]?.message ?? 'Invalid browser parameters')
  return parsed.data as Record<string, unknown>
}
export function browserErrorEnvelope(error: unknown): { ok: false; error: { code: string; message: string; data?: unknown } } {
  const details = error as { code?: unknown; message?: unknown; data?: unknown } | null
  return { ok: false, error: {
    code: typeof details?.code === 'string' ? details.code : 'internal_error',
    message: typeof details?.message === 'string' ? details.message : String(error),
    ...(details?.data !== undefined ? { data: details.data } : {})
  } }
}
