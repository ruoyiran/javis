import { JavisError } from '../error.js'

export function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new JavisError('invalid_argument', `missing ${key}`)
  }
  return value
}

export function optionalStringParam(
  params: Record<string, unknown>,
  key: string
): string | undefined {
  const value = params[key]
  return typeof value === 'string' ? value : undefined
}

export function optionalNumberParam(
  params: Record<string, unknown>,
  key: string
): number | undefined {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function screenshotRequestParams(params: Record<string, unknown>) {
  return {
    noScreenshot: params.noScreenshot === true,
    ...(params.screenshotFormat === 'jpeg' ? { screenshotFormat: 'jpeg' as const } : {}),
    ...(params.screenshotScale === undefined ? {} : { screenshotScale: optionalNumberParam(params, 'screenshotScale') }),
    ...(params.screenshotMaxEdge === undefined ? {} : { screenshotMaxEdge: optionalNumberParam(params, 'screenshotMaxEdge') })
  }
}
