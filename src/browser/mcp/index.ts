import { z } from 'zod'
import { JavisError } from '../../runtime/error.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { browserMethodSchemas, publicBrowserMethods, validateBrowserParams, browserErrorEnvelope, type BrowserCall, type BrowserMethod, type BrowserTarget } from '../contract/index.js'

export type BrowserMcpRegistration = (
  name: string,
  config: { description: string; inputSchema: z.ZodRawShape; annotations: ToolAnnotations },
  handler: (params: Record<string, unknown>) => Promise<CallToolResult>
) => void
export type BrowserMcpDependencies = { call: BrowserCall }
const readOnlyMethods = new Set(['browser.snapshot', 'browser.screenshot', 'browser.fullScreenshot', 'browser.pdf', 'browser.get', 'browser.is', 'browser.tabList', 'browser.tabShow', 'browser.tabCurrent', 'browser.tabAnnotations', 'browser.tabProfileShow', 'browser.profileList', 'browser.profileDetectBrowsers', 'browser.identity.get', 'browser.extensionList', 'browser.cookie.get', 'browser.clipboardRead', 'browser.console', 'browser.network', 'browser.intercept.list', 'browser.storage.local.get', 'browser.storage.session.get'])
function sourceObject(schema: z.ZodType): z.ZodObject {
  if (schema instanceof z.ZodPipe) return sourceObject(schema.in as z.ZodType)
  return schema as z.ZodObject
}
export function browserMcpInputSchema(method: BrowserMethod): z.ZodRawShape {
  return {
    ...sourceObject(browserMethodSchemas[method]).shape,
    host: z.string().min(1).optional().describe('SSH alias for the Javis browser host.'),
    context: z.string().min(1).optional().describe('Folder or session namespace on the selected host.'),
    session: z.string().min(1).optional().describe('Session namespace; alias for context.')
  }
}
export function browserMcpToolName(method: BrowserMethod): string {
  return `javis_${method.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replaceAll('.', '_').toLowerCase()}`
}
export function registerBrowserMcpTools(register: BrowserMcpRegistration, deps: BrowserMcpDependencies): void {
  for (const method of publicBrowserMethods) {
    const readOnly = readOnlyMethods.has(method)
    register(browserMcpToolName(method), {
      description: `Javis ${method.replaceAll('.', ' ')}. Uses the migrated browser contract.` + (readOnly ? ' Reads the selected page or browser configuration.' : ' Pin page IDs and use expectUrl for supported page actions. Use refs from a fresh snapshot of this page and context. After uncertain delivery, observe again before acting; never automatically repeat input.'),
      inputSchema: browserMcpInputSchema(method),
      annotations: { readOnlyHint: readOnly, idempotentHint: readOnly }
    }, async params => {
      try {
        if (['context', 'session', 'worktree'].filter(name => params[name] !== undefined).length > 1) throw new JavisError('invalid_argument', 'Choose one of context, session, or worktree')
        const { host, context, session, ...runtimeParams } = params
        const namespace = context ?? session ?? runtimeParams.worktree
        const target: BrowserTarget = { ...(typeof host === 'string' ? { host } : {}), ...(typeof namespace === 'string' ? { context: namespace } : {}) }
        const result = await deps.call(method, validateBrowserParams(method, { ...runtimeParams, ...(typeof namespace === 'string' && runtimeParams.worktree === undefined ? { worktree: namespace } : {}) }), target)
        return toBrowserMcpResult(result)
      } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(browserErrorEnvelope(error)) }] } }
    })
  }
}
export function toBrowserMcpResult(result: unknown): CallToolResult {
  const object = result && typeof result === 'object' ? result as Record<string, unknown> : null
  const data = object?.data
  if (typeof data === 'string' && data.length && (object?.format === 'png' || object?.format === 'jpeg')) {
    const { data: _data, ...metadata } = object
    return { structuredContent: { ok: true, result: metadata }, content: [{ type: 'text', text: JSON.stringify({ ok: true, result: metadata }) }, { type: 'image', data, mimeType: object.format === 'jpeg' ? 'image/jpeg' : 'image/png' }] }
  }
  return { ...(object ? { structuredContent: { ok: true, result: object } } : {}), content: [{ type: 'text', text: JSON.stringify({ ok: true, result }) }] }
}
