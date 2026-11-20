import type { JavisMethod } from '../runtime/public.js'
import {
  computerUseClickModifiersValidationMessage,
  computerUseHotkeyValidationMessage,
  computerUsePressKeyValidationMessage
} from '../contract/computer-use-key-spec.js'
import { CliArgumentError, splitCliArguments } from './arguments.js'
export { CliArgumentError } from './arguments.js'

export type ParsedCall = {
  method: JavisMethod | 'wait'
  params: Record<string, unknown>
  json: boolean
  host?: string
  query?: string
  maxElements?: number
}

const methods: Record<string, JavisMethod> = {
  capabilities: 'capabilities',
  'list-apps': 'listApps',
  'launch-app': 'launchApp',
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

function fail(message: string): never { throw new CliArgumentError(message) }

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
  if (!raw.trim() || !Number.isFinite(result) || (integer && (!Number.isSafeInteger(result) || result < 0))) {
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
  const { command, flags } = splitCliArguments(argv)
  const path = command[0] === 'computer' ? command.slice(1) : command
  const name = path[0]
  const method = name === 'wait' ? 'wait' : methods[name]
  if (!method) fail(`Unknown command: ${name ?? '(none)'}`)
  if (path.length !== 1 && (method !== 'launchApp' || path.length !== 2)) fail(`Unexpected argument after ${name}`)
  const params: Record<string, unknown> = {}
  const json = flags.has('json')
  const host = value(flags, 'host')
  for (const flag of ['host', 'worktree', 'session']) if (flags.has(flag) && !value(flags, flag)) fail(`--${flag} requires a non-empty value`)
  if (method === 'launchApp') {
    if (path[1] !== undefined && flags.has('app')) fail('Choose the app positional argument or --app')
    const app = path[1] ?? required(flags, 'app')
    for (const flag of flags.keys()) if (!['app', 'activate', 'host', 'json'].includes(flag)) fail(`--${flag} is not supported by launch-app`)
    return { method, params: { app, ...(flags.get('activate') === true ? { activate: true } : {}) }, json, ...(host ? { host } : {}) }
  }
  const action = !['capabilities', 'listApps', 'listWindows', 'getAppState', 'wait'].includes(method)
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
  if (method === 'wait') {
    const conditions = ['text', 'enabled', 'window-title'].flatMap(kind => value(flags, kind) === undefined ? [] : [{ kind, value: value(flags, kind) }])
    if (conditions.length !== 1 || !conditions[0].value) fail('Choose exactly one of --text, --enabled, or --window-title')
    if (conditions[0].kind === 'window-title' && (params.windowId !== undefined || params.windowIndex !== undefined)) fail('--window-title cannot use window-id or window-index')
    const timeoutMs = number(flags, 'timeout', true)
    if (timeoutMs !== undefined && (timeoutMs <= 0 || timeoutMs > 120000)) fail('--timeout must be a positive integer at most 120000 ms')
    params.condition = conditions[0]
    put(params, 'timeoutMs', timeoutMs)
    for (const flag of flags.keys()) if (!['app', 'host', 'worktree', 'session', 'window-id', 'window-index', 'text', 'enabled', 'window-title', 'timeout', 'json'].includes(flag)) fail(`--${flag} is not supported by wait`)
    return { method, params, json, ...(host ? { host } : {}) }
  }
  if (flags.has('no-screenshot')) params.noScreenshot = true
  if (flags.has('restore-window')) params.restoreWindow = true
  const screenshotFormat = value(flags, 'screenshot-format')
  if (screenshotFormat !== undefined && screenshotFormat !== 'png' && screenshotFormat !== 'jpeg') fail('--screenshot-format must be png or jpeg')
  put(params, 'screenshotFormat', screenshotFormat)
  const screenshotScale = number(flags, 'screenshot-scale')
  if (screenshotScale !== undefined && screenshotScale <= 0) fail('--screenshot-scale must be positive')
  put(params, 'screenshotScale', screenshotScale)
  const screenshotMaxEdge = number(flags, 'screenshot-max-edge', true)
  if (screenshotMaxEdge !== undefined && screenshotMaxEdge <= 0) fail('--screenshot-max-edge must be a positive integer')
  put(params, 'screenshotMaxEdge', screenshotMaxEdge)
  if (flags.get('allow-system-shortcut') === true) params.allowSystemShortcut = true
  if (action) {
    params.treeDiff = !flags.has('full-tree')
  } else if (flags.has('full-tree')) fail('--full-tree is only valid for actions')

  for (const [flag, key] of [
    ['element-index', method === 'getAppState' ? 'rootElementIndex' : 'elementIndex'], ['from-element-index', 'fromElementIndex'],
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
  if (method === 'performSecondaryAction' && (params.elementIndex === undefined || !params.action)) fail('perform-secondary-action needs --element-index and --action')
  if ((method === 'typeText' || method === 'pasteText') && !params.text) fail(`${name} needs --text or --text-stdin`)
  if ((method === 'pressKey' || method === 'hotkey') && !params.key) fail(`${name} needs --key`)
  if (method === 'scroll' && !params.direction) fail('scroll needs --direction')
  if (params.clickCount !== undefined && Number(params.clickCount) < 1) fail('--click-count must be a positive integer')
  if (params.pages !== undefined && Number(params.pages) <= 0) fail('--pages must be a positive number')
  if (params.mouseButton !== undefined && !['left', 'right', 'middle'].includes(String(params.mouseButton))) fail('--mouse-button must be left, right, or middle')
  if (params.direction !== undefined && !['up', 'down', 'left', 'right'].includes(String(params.direction))) fail('--direction must be up, down, left, or right')
  const keyMessage = method === 'hotkey'
    ? computerUseHotkeyValidationMessage(String(params.key))
    : method === 'pressKey' ? computerUsePressKeyValidationMessage(String(params.key)) : null
  if (keyMessage) fail(keyMessage)
  if (params.modifiers !== undefined) {
    const message = computerUseClickModifiersValidationMessage(String(params.modifiers))
    if (message) fail(message)
  }

  const query = value(flags, 'query')
  const maxElements = number(flags, 'max-elements', true)
  if (maxElements !== undefined && maxElements < 1) fail('--max-elements must be a positive integer')
  if (method !== 'getAppState' && (query !== undefined || maxElements !== undefined)) fail('--query and --max-elements are only valid for get-app-state')
  const allowed = new Set([
    'app', 'host', 'worktree', 'session', 'window-id', 'window-index', 'no-screenshot', 'restore-window', 'json', 'screenshot-format', 'screenshot-scale', 'screenshot-max-edge',
    ...(action ? ['full-tree'] : []),
    ...(method === 'getAppState' ? ['query', 'max-elements', 'element-index'] : []),
    ...(method === 'click' ? ['element-index', 'x', 'y', 'click-count', 'mouse-button', 'modifiers'] : []),
    ...(method === 'scroll' ? ['element-index', 'x', 'y', 'direction', 'pages'] : []),
    ...(method === 'drag' ? ['from-element-index', 'to-element-index', 'from-x', 'from-y', 'to-x', 'to-y'] : []),
    ...(method === 'setValue' ? ['element-index', 'value', 'value-stdin'] : []),
    ...(method === 'performSecondaryAction' ? ['element-index', 'action'] : []),
    ...(method === 'typeText' ? ['element-index'] : []),
    ...(method === 'typeText' || method === 'pasteText' ? ['text', 'text-stdin'] : []),
    ...(method === 'pressKey' || method === 'hotkey' ? ['key', 'allow-system-shortcut'] : [])
  ])
  for (const flag of flags.keys()) if (!allowed.has(flag)) fail(`--${flag} is not supported by ${name}`)
  return {
    method, params, json,
    ...(host ? { host } : {}),
    ...(query !== undefined ? { query } : {}),
    ...(maxElements !== undefined ? { maxElements } : {})
  }
}
