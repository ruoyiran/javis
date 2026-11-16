import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { callJavis } from '../runtime/public.js'
import { readJavisPermissionStatus } from '../permissions.js'
import { queryComputerTreeText } from '../cli/tree-query.js'
import { toMcpError, toMcpResult } from './result.js'

export function createJavisMcpServer(): McpServer {
  const sessionId = randomUUID()
  const server = new McpServer({ name: 'javis', version: '0.1.0' })
  const target = { app: z.string().min(1), windowId: z.number().int().optional(), windowIndex: z.number().int().nonnegative().optional() }
  const common = { ...target, noScreenshot: z.boolean().optional(), restoreWindow: z.boolean().optional() }
  const point = z.number().finite()
  const element = z.number().int().nonnegative()
  const definitions = [
    ['capabilities', 'capabilities', {}, false],
    ['list_apps', 'listApps', {}, false],
    ['list_windows', 'listWindows', target, false],
    ['get_app_state', 'getAppState', { ...common, query: z.string().optional(), maxElements: z.number().int().positive().optional() }, true],
    ['click', 'click', { ...common, elementIndex: element.optional(), x: point.optional(), y: point.optional(), mouseButton: z.enum(['left', 'right', 'middle']).optional(), modifiers: z.string().optional(), clickCount: z.number().int().min(1).max(3).optional() }, true],
    ['set_value', 'setValue', { ...common, elementIndex: element, value: z.string() }, true],
    ['type_text', 'typeText', { ...common, text: z.string() }, true],
    ['press_key', 'pressKey', { ...common, key: z.string().min(1) }, true],
    ['hotkey', 'hotkey', { ...common, key: z.string().min(1) }, true],
    ['paste_text', 'pasteText', { ...common, text: z.string() }, true],
    ['scroll', 'scroll', { ...common, elementIndex: element.optional(), direction: z.enum(['up', 'down', 'left', 'right']), pages: z.number().positive().optional(), x: point.optional(), y: point.optional() }, true],
    ['drag', 'drag', { ...common, fromElementIndex: element.optional(), toElementIndex: element.optional(), fromX: point.optional(), fromY: point.optional(), toX: point.optional(), toY: point.optional() }, true],
    ['perform_secondary_action', 'performSecondaryAction', { ...common, elementIndex: element, action: z.string().min(1) }, true]
  ] as const
  for (const [name, method, inputSchema, usesSession] of definitions) {
    server.registerTool(`javis_${name}`, { description: `Javis ${name.replaceAll('_', ' ')}. Uses background operation by default; restoreWindow=true explicitly restores and activates the target window.`, inputSchema }, async (params: Record<string, unknown>) => {
      try {
        const { query, maxElements, ...runtimeParams } = params
        const value = await callJavis(method, usesSession ? { ...runtimeParams, sessionId } : runtimeParams)
        if (method === 'getAppState' && (query !== undefined || maxElements !== undefined)) {
          const result = value as { snapshot: { treeText: string } }
          return toMcpResult({ ...result, snapshot: { ...result.snapshot, treeText: queryComputerTreeText(result.snapshot.treeText, { ...(typeof query === 'string' ? { query } : {}), ...(typeof maxElements === 'number' ? { maxElements } : {}) }) } })
        }
        return toMcpResult(value)
      }
      catch (error) { return toMcpError(error) }
    })
  }
  server.registerTool('javis_permissions_status', { description: 'Read macOS Accessibility and screenshot permission status.', inputSchema: {} }, async () => {
    try { return toMcpResult(await readJavisPermissionStatus()) }
    catch (error) { return toMcpError(error) }
  })
  return server
}

export async function runJavisMcp(): Promise<void> {
  await createJavisMcpServer().connect(new StdioServerTransport())
}
