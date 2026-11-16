import type { JavisMethod } from '../runtime/public.js'

export type ParsedCall = {
  method: JavisMethod
  params: Record<string, unknown>
  json: boolean
  host?: string
  query?: string
  maxElements?: number
}

export class CliArgumentError extends Error {
  readonly code = 'invalid_argument'
}

const methods: Record<string, JavisMethod> = {
  capabilities: 'capabilities',
  'list-apps': 'listApps',
  'list-windows': 'listWindows',
  'get-app-state': 'getAppState',
  click: 'click',
  'perform-secondary-action': 'performSecondaryAction',
  scroll: 'scroll',
  drag: 'drag',
  'type-text': 'typeText',
  'press-key': 'pressKey',
  hotkey: 'hotkey',
  'paste-text': 'pasteText',
  'set-value': 'setValue'
}

const booleanFlags = new Set(['json', 'no-screenshot', 'restore-window', 'full-tree', 'text-stdin', 'value-stdin'])
const valueFlags = new Set([
  'app', 'host', 'worktree', 'session', 'window-id', 'window-index', 'element-index', 'from-element-index',
  'to-element-index', 'x', 'y', 'from-x', 'from-y', 'to-x', 'to-y', 'click-count',
  'mouse-button', 'modifiers', 'action', 'direction', 'pages', 'text', 'key',
  'value', 'query', 'max-elements'
])

function fail(message: string): never { throw new CliArgumentError(message) }

function flagsOf(argv: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`)
    const name = token.slice(2)
    if (flags.has(name)) fail(`Duplicate flag --${name}`)
    if (booleanFlags.has(name)) flags.set(name, true)
    else if (valueFlags.has(name)) {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) fail(`Missing value for --${name}`)
      flags.set(name, value)
    } else fail(`Unknown flag --${name}`)
  }
  return flags
}

function value(flags: Map<string, string | true>, name: string): string | undefined {
  const raw = flags.get(name)
  return typeof raw === 'string' ? raw : undefined
}

function required(flags: Map<string, string | true>, name: string): string {
  const result = value(flags, name)
  if (!result) fail(`--${name} is required`)
  return result
}

function number(flags: Map<string, string | true>, name: string, integer = false): number | undefined {
  const raw = value(flags, name)
  if (raw === undefined) return undefined
  const result = Number(raw)
  if (!Number.isFinite(result) || (integer && (!Number.isInteger(result) || result < 0))) {
    fail(`--${name} must be ${integer ? 'a non-negative integer' : 'a finite number'}`)
  }
  return result
}

function put(target: Record<string, unknown>, key: string, candidate: unknown): void {
  if (candidate !== undefined) target[key] = candidate
}

function elementOrCoordinates(params: Record<string, unknown>, prefix = ''): void {
  const element = params[prefix ? `${prefix}ElementIndex` : 'elementIndex'] !== undefined
  const x = params[prefix ? `${prefix}X` : 'x'] !== undefined
  const y = params[prefix ? `${prefix}Y` : 'y'] !== undefined
  if (element === (x && y) || x !== y) fail('Choose either an element index or both coordinates')
}

export function parseCall(argv: string[], stdinText?: string): ParsedCall {
  const name = argv[0]
  const method = methods[name]
  if (!method) fail(`Unknown command: ${name ?? '(none)'}`)
  const flags = flagsOf(argv.slice(1))
  const params: Record<string, unknown> = {}
  const json = flags.has('json')
  const host = value(flags, 'host')
  const action = !['capabilities', 'listApps', 'listWindows', 'getAppState'].includes(method)
  if (method !== 'capabilities' && method !== 'listApps') params.app = required(flags, 'app')
  if (method === 'listWindows' || method === 'capabilities' || method === 'listApps') {
    const allowed = new Set(['json', 'host', ...(method === 'listWindows' ? ['app'] : [])])
    for (const flag of flags.keys()) if (!allowed.has(flag)) fail(`--${flag} is not supported by ${name}`)
    return { method, params, json, ...(host ? { host } : {}) }
  }

  put(params, 'sessionId', value(flags, 'session'))
  put(params, 'worktree', value(flags, 'worktree'))
  if (params.sessionId !== undefined && params.worktree !== undefined) fail('Choose either --session or --worktree')
  put(params, 'windowId', number(flags, 'window-id', true))
  put(params, 'windowIndex', number(flags, 'window-index', true))
  if (params.windowId !== undefined && params.windowIndex !== undefined) fail('Choose either --window-id or --window-index')
  if (flags.has('no-screenshot')) params.noScreenshot = true
  if (flags.has('restore-window')) params.restoreWindow = true
  if (action) {
    params.treeDiff = !flags.has('full-tree')
  } else if (flags.has('full-tree')) fail('--full-tree is only valid for actions')

  for (const [flag, key] of [
    ['element-index', 'elementIndex'], ['from-element-index', 'fromElementIndex'],
    ['to-element-index', 'toElementIndex']
  ]) put(params, key, number(flags, flag, true))
  for (const [flag, key] of [
    ['x', 'x'], ['y', 'y'], ['from-x', 'fromX'], ['from-y', 'fromY'],
    ['to-x', 'toX'], ['to-y', 'toY'], ['pages', 'pages']
  ]) put(params, key, number(flags, flag))
  put(params, 'clickCount', number(flags, 'click-count', true))
  for (const [flag, key] of [
    ['mouse-button', 'mouseButton'], ['modifiers', 'modifiers'], ['direction', 'direction'],
    ['action', 'action'], ['key', 'key']
  ]) put(params, key, value(flags, flag))

  if (flags.has('text-stdin') && value(flags, 'text') !== undefined) fail('Choose either --text or --text-stdin')
  if (flags.has('value-stdin') && value(flags, 'value') !== undefined) fail('Choose either --value or --value-stdin')
  if ((flags.has('text-stdin') || flags.has('value-stdin')) && stdinText === undefined) fail('Stdin text is required')
  put(params, 'text', flags.has('text-stdin') ? stdinText : value(flags, 'text'))
  put(params, 'value', flags.has('value-stdin') ? stdinText : value(flags, 'value'))

  if (method === 'click' || method === 'scroll') elementOrCoordinates(params)
  if (method === 'drag') {
    elementOrCoordinates(params, 'from')
    elementOrCoordinates(params, 'to')
    if ((params.fromElementIndex !== undefined) !== (params.toElementIndex !== undefined)) {
      fail('Drag needs two element indexes or four coordinates')
    }
  }
  if (method === 'setValue' && (params.elementIndex === undefined || params.value === undefined)) fail('set-value needs --element-index and --value or --value-stdin')
  if (method === 'performSecondaryAction' && (params.elementIndex === undefined || params.action === undefined)) fail('perform-secondary-action needs --element-index and --action')
  if ((method === 'typeText' || method === 'pasteText') && !params.text) fail(`${name} needs --text or --text-stdin`)
  if ((method === 'pressKey' || method === 'hotkey') && !params.key) fail(`${name} needs --key`)
  if (method === 'scroll' && !params.direction) fail('scroll needs --direction')

  const query = value(flags, 'query')
  const maxElements = number(flags, 'max-elements', true)
  if (maxElements !== undefined && maxElements < 1) fail('--max-elements must be a positive integer')
  if (method !== 'getAppState' && (query !== undefined || maxElements !== undefined)) fail('--query and --max-elements are only valid for get-app-state')
  const allowed = new Set([
    'app', 'host', 'worktree', 'session', 'window-id', 'window-index', 'no-screenshot', 'restore-window', 'json',
    ...(action ? ['full-tree'] : []),
    ...(method === 'getAppState' ? ['query', 'max-elements'] : []),
    ...(method === 'click' ? ['element-index', 'x', 'y', 'click-count', 'mouse-button', 'modifiers'] : []),
    ...(method === 'scroll' ? ['element-index', 'x', 'y', 'direction', 'pages'] : []),
    ...(method === 'drag' ? ['from-element-index', 'to-element-index', 'from-x', 'from-y', 'to-x', 'to-y'] : []),
    ...(method === 'setValue' ? ['element-index', 'value', 'value-stdin'] : []),
    ...(method === 'performSecondaryAction' ? ['element-index', 'action'] : []),
    ...(method === 'typeText' || method === 'pasteText' ? ['text', 'text-stdin'] : []),
    ...(method === 'pressKey' || method === 'hotkey' ? ['key'] : [])
  ])
  for (const flag of flags.keys()) if (!allowed.has(flag)) fail(`--${flag} is not supported by ${name}`)
  return {
    method, params, json,
    ...(host ? { host } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(maxElements !== undefined ? { maxElements } : {})
  }
}
