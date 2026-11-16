import { validateComputerProviderActionParams } from '../runtime/computer-provider-action-validation.js'
import type { DeviceTarget } from './device-session.js'
import { imagePointToWindowPoint } from './coordinates.js'

const actionFields = {
  click: ['elementIndex', 'x', 'y', 'tap', 'clickCount', 'mouseButton', 'modifiers'],
  performSecondaryAction: ['elementIndex', 'action'],
  scroll: ['elementIndex', 'x', 'y', 'tap', 'direction', 'pages'],
  drag: ['fromElementIndex', 'toElementIndex', 'fromX', 'fromY', 'toX', 'toY'],
  typeText: ['text'],
  pressKey: ['key'],
  hotkey: ['key'],
  pasteText: ['text'],
  setValue: ['elementIndex', 'value']
} as const

export type MobileActionMethod = keyof typeof actionFields

export function isMobileActionMethod(method: unknown): method is MobileActionMethod {
  return typeof method === 'string' && Object.hasOwn(actionFields, method)
}

export async function actionRequestParams(
  method: MobileActionMethod,
  input: Record<string, unknown>,
  target: DeviceTarget
): Promise<Record<string, unknown>> {
  const allowed = new Set<string>([...actionFields[method], 'restoreWindow'])
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Unsupported action parameter')
  if (input.restoreWindow !== undefined && typeof input.restoreWindow !== 'boolean') throw new Error('Invalid foreground choice')
  const params: Record<string, unknown> = { ...input }
  if (params.tap !== undefined) {
    if (params.elementIndex !== undefined || params.x !== undefined || params.y !== undefined || !target.screenshot) {
      throw new Error('Screenshot tap requires the last captured image')
    }
    const tap = params.tap
    if (!record(tap) || Object.keys(tap).sort().join(',') !== 'clientX,clientY,rectHeight,rectWidth') {
      throw new Error('Invalid screenshot tap')
    }
    const { x, y } = imagePointToWindowPoint({
      clientX: number(tap.clientX), clientY: number(tap.clientY),
      rectWidth: number(tap.rectWidth), rectHeight: number(tap.rectHeight),
      imageWidth: target.screenshot.width, imageHeight: target.screenshot.height,
      scale: target.screenshot.scale
    })
    delete params.tap
    params.x = x
    params.y = y
  }
  if (params.clickCount !== undefined && (!Number.isInteger(params.clickCount) || (params.clickCount as number) > 3)) {
    throw new Error('Invalid click count')
  }
  const bound = {
    ...params,
    app: target.app,
    ...(target.windowId !== undefined ? { windowId: target.windowId } : {}),
    ...(target.windowIndex !== undefined ? { windowIndex: target.windowIndex } : {}),
    sessionId: target.sessionId,
    treeDiff: false
  }
  await validateComputerProviderActionParams(method, bound)
  return bound
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function number(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Invalid screenshot tap')
  return value
}
