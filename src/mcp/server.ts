import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool, type ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { callTarget, type JavisTarget } from '../runtime/target-router.js'
import { callJavis } from '../runtime/public.js'
import { normalizeWorktreeContext } from '../runtime/workspace-context.js'
import { JavisError } from '../runtime/error.js'
import { callRemoteJavis } from '../runtime/remote-stdio.js'
import { validateComputerProviderActionParams } from '../runtime/computer-provider-action-validation.js'
import { queryComputerTreeText } from '../cli/tree-query.js'
import { toMcpError, toMcpResult } from './result.js'
import { JAVIS_VERSION } from '../version.js'
import { registerBrowserMcpTools } from '../browser/mcp/index.js'
import { waitForComputer } from '../cli/computer-wait.js'

export function createJavisMcpServer(): Server {
  const sessions = new Map<string, string>()
  // Own tool validation so SDK schema errors cannot echo inputs or bypass Javis error envelopes.
  const server = new Server({ name: 'javis', version: JAVIS_VERSION }, { capabilities: { tools: {} } })
  const tools = new Map<string, {
    definition: Tool
    schema: z.ZodObject<z.ZodRawShape>
    handler: (params: Record<string, unknown>) => Promise<CallToolResult>
  }>()
  const registerTool = (
    name: string,
    config: { description: string; inputSchema: z.ZodRawShape; annotations: ToolAnnotations },
    handler: (params: Record<string, unknown>) => Promise<CallToolResult>
  ) => {
    const schema = z.object(config.inputSchema).strict()
    tools.set(name, {
      definition: { name, description: config.description, annotations: config.annotations, inputSchema: z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as Tool['inputSchema'] },
      schema,
      handler
    })
  }
  const destination = {
    host: z.string().min(1).optional().describe('SSH alias for the Javis desktop host.'),
    worktree: z.string().min(1).optional().describe('Session context on the selected host. Use the same context for observation and actions.')
  }
  const app = z.string().min(1).describe('Running desktop app name, bundle ID, or pid:N; website names are not app selectors.')
  const target = { ...destination, app, windowId: z.number().int().nonnegative().optional(), windowIndex: z.number().int().nonnegative().optional() }
  const common = {
    ...target,
    noScreenshot: z.boolean().optional(),
    screenshotFormat: z.enum(['png', 'jpeg']).optional(),
    screenshotScale: z.number().finite().positive().optional(),
    screenshotMaxEdge: z.number().int().positive().optional(),
    restoreWindow: z.boolean().optional().describe('Explicitly bring the target forward; this can change desktop focus.'),
    treeDiff: z.boolean().optional().describe('Return a diff against the previous tree when possible. Actions default to true; false requests the full tree.')
  }
  const actionCommon = { ...common, fullTree: z.boolean().optional().describe('Request the full action-result tree. Cannot be true with treeDiff=true.') }
  const point = z.number().finite()
  const element = z.number().int().nonnegative()
  const definitions = [
    ['capabilities', 'capabilities', { host: destination.host }, false],
    ['list_apps', 'listApps', { host: destination.host }, false],
    ['launch_app', 'launchApp', { host: destination.host, app: z.string().min(1).describe('Installed app name, bundle ID or path.'), activate: z.boolean().optional().describe('Activate only a newly launched app; explicitly takes foreground focus.') }, false],
    ['list_windows', 'listWindows', { host: destination.host, app }, false],
    ['get_app_state', 'getAppState', { ...common, rootElementIndex: element.optional(), query: z.string().optional(), maxElements: z.number().int().positive().optional() }, true],
    ['click', 'click', { ...actionCommon, elementIndex: element.optional(), x: point.optional(), y: point.optional(), mouseButton: z.enum(['left', 'right', 'middle']).optional(), modifiers: z.string().optional(), clickCount: z.number().int().positive().optional() }, true],
    ['set_value', 'setValue', { ...actionCommon, elementIndex: element, value: z.string() }, true],
    ['type_text', 'typeText', { ...actionCommon, elementIndex: element.optional(), text: z.string().min(1) }, true],
    ['press_key', 'pressKey', { ...actionCommon, allowSystemShortcut: z.boolean().optional(), key: z.string().min(1).describe('One key such as Return, Escape, Tab, or +. Use hotkey for a chord.') }, true],
    ['hotkey', 'hotkey', { ...actionCommon, allowSystemShortcut: z.boolean().optional(), key: z.string().min(1).describe('Modifier chord plus one key, for example CmdOrCtrl+A.') }, true],
    ['paste_text', 'pasteText', { ...actionCommon, text: z.string().min(1) }, true],
    ['scroll', 'scroll', { ...actionCommon, elementIndex: element.optional(), direction: z.enum(['up', 'down', 'left', 'right']), pages: z.number().positive().optional(), x: point.optional(), y: point.optional() }, true],
    ['drag', 'drag', { ...actionCommon, fromElementIndex: element.optional(), toElementIndex: element.optional(), fromX: point.optional(), fromY: point.optional(), toX: point.optional(), toY: point.optional() }, true],
    ['perform_secondary_action', 'performSecondaryAction', { ...actionCommon, elementIndex: element, action: z.string().min(1) }, true]
  ] as const
  for (const [name, method, inputSchema, usesSession] of definitions) {
    const action = usesSession && method !== 'getAppState'
    const description = `Javis ${name.replaceAll('_', ' ')}.` + (action
      ? ' Requires a fresh observation of the same app, window, host, and context. For indexed or coordinate actions, use indexes from that tree or window-local coordinates (image pixels divided by screenshot.scale). Check capabilities before actions. After uncertain delivery or observationError, inspect again before acting; never automatically repeat the action.'
      : method === 'getAppState' ? ' Observe without changing focus unless restoreWindow=true. Read snapshot.treeDiff to distinguish a diff from a full tree; indexes may be sparse.' : method === 'launchApp' ? ' Start an installed app in the background. Already-running apps are left as they are; delivery reports actual foreground/background.' : ' Read the selected desktop host.')
    registerTool(`javis_${name}`, { description, inputSchema, annotations: { readOnlyHint: !usesSession && method !== 'launchApp', idempotentHint: !action } }, async (params: Record<string, unknown>) => {
      try {
        if (params.windowId !== undefined && params.windowIndex !== undefined) {
          throw new JavisError('invalid_argument', 'Choose either windowId or windowIndex')
        }
        const { query, maxElements, host, worktree, fullTree, ...runtimeParams } = params
        if (fullTree === true && runtimeParams.treeDiff === true) {
          throw new JavisError('invalid_argument', 'Choose fullTree=true or treeDiff=true, not both')
        }
        if (action) await validateComputerProviderActionParams(method, runtimeParams)
        const destination: JavisTarget = {
          ...(typeof host === 'string' ? { host } : {}),
          ...(typeof worktree === 'string' ? { context: normalizeWorktreeContext(worktree) } : {})
        }
        const sessionKey = JSON.stringify([host ?? null, worktree ?? null])
        let sessionId = sessions.get(sessionKey)
        if (!sessionId) { sessionId = randomUUID(); sessions.set(sessionKey, sessionId) }
        const value = await callTarget(method, usesSession
          ? { ...runtimeParams, ...(worktree === undefined ? { sessionId } : {}), ...(action ? { treeDiff: fullTree === true ? false : runtimeParams.treeDiff ?? true } : {}) }
          : runtimeParams, destination)
        if (method === 'getAppState' && (query !== undefined || maxElements !== undefined)) {
          const result = value as { snapshot: { treeText: string } }
          return toMcpResult({ ...result, snapshot: { ...result.snapshot, treeText: queryComputerTreeText(result.snapshot.treeText, { ...(typeof query === 'string' ? { query } : {}), ...(typeof maxElements === 'number' ? { maxElements } : {}) }) } })
        }
        return toMcpResult(value)
      }
      catch (error) { return toMcpError(error) }
    })
  }
  registerTool('javis_permissions_status', { description: 'Read macOS Accessibility and screenshot permission status on the local or selected SSH host.', inputSchema: { host: destination.host }, annotations: { readOnlyHint: true, idempotentHint: true } }, async (params: { host?: string }) => {
    try { return toMcpResult(params.host ? await callRemoteJavis('permissionsStatus', {}, params.host) : await callJavis('permissionsStatus', {})) }
    catch (error) { return toMcpError(error) }
  })
  registerBrowserMcpTools(registerTool, { call: (method, params, target) => callTarget(method as Parameters<typeof callTarget>[0], params, target) })
  registerTool('javis_wait', {
    description: 'Wait for text, enabled controls or a window title without changing focus. Use exactly one condition; enabled requires disabled-state support. Observe again after a timeout.',
    inputSchema: { ...target, text: z.string().min(1).optional(), enabled: z.string().min(1).optional(), windowTitle: z.string().min(1).optional(), timeoutMs: z.number().int().positive().max(120000).optional() },
    annotations: { readOnlyHint: true, idempotentHint: true }
  }, async params => {
    try {
      const conditions = ([['text', 'text'], ['enabled', 'enabled'], ['windowTitle', 'window-title']] as const).flatMap(([key, kind]) => typeof params[key] === 'string' ? [{ kind, value: params[key] as string }] : [])
      if (conditions.length !== 1) throw new JavisError('invalid_argument', 'Choose exactly one wait condition')
      const host = typeof params.host === 'string' ? params.host : undefined
      const worktree = typeof params.worktree === 'string' ? params.worktree : undefined
      const destination: JavisTarget = { ...(host ? { host } : {}), ...(worktree ? { context: normalizeWorktreeContext(worktree) } : {}) }
      const key = JSON.stringify([host ?? null, worktree ?? null])
      let sessionId = sessions.get(key)
      if (!sessionId) { sessionId = randomUUID(); sessions.set(key, sessionId) }
      const result = await waitForComputer({
        app: params.app as string, condition: conditions[0],
        ...(worktree === undefined ? { sessionId } : {}),
        ...(typeof params.windowId === 'number' ? { windowId: params.windowId } : {}),
        ...(typeof params.windowIndex === 'number' ? { windowIndex: params.windowIndex } : {}),
        ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {})
      }, destination)
      return toMcpResult(result)
    } catch (error) { return toMcpError(error) }
  })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools.values()].map(tool => tool.definition) }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const tool = tools.get(request.params.name)
      if (!tool) throw new JavisError('invalid_argument', 'Unknown Javis tool')
      const parsed = await tool.schema.safeParseAsync(request.params.arguments ?? {})
      if (!parsed.success) throw new JavisError('invalid_argument', 'Invalid tool arguments; check the tool input schema')
      return await tool.handler(parsed.data)
    } catch (error) { return toMcpError(error) }
  })
  return server
}

export async function runJavisMcp(): Promise<void> {
  await createJavisMcpServer().connect(new StdioServerTransport())
}
