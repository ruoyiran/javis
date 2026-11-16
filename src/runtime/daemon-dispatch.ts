import { JavisError } from './error.js'
import type { JavisMethod } from './session.js'

export type JavisDaemonMethod = JavisMethod | 'permissionsStatus' | 'permissionsOpen' | 'permissionsReset'

type PermissionId = 'accessibility' | 'screenshots'
type PermissionOperations = {
  status: () => Promise<unknown>
  open: (id?: PermissionId, canDeliver?: () => boolean) => Promise<unknown>
  reset: (canDeliver?: () => boolean) => Promise<unknown>
}

export function createDaemonDispatch(
  computer: (method: JavisMethod, params: Record<string, unknown>) => Promise<unknown>,
  permissions: PermissionOperations
): (method: JavisDaemonMethod, params: Record<string, unknown>, canDeliver?: () => boolean) => Promise<unknown> {
  return async (method, params, canDeliver = () => true) => {
    if (!canDeliver()) throw new JavisError('action_timeout', 'Caller disconnected before request delivery')
    if (method === 'permissionsStatus' || method === 'permissionsReset') {
      if (Object.keys(params).length) throw new JavisError('invalid_argument', `${method} does not accept parameters`)
      return method === 'permissionsStatus' ? permissions.status() : permissions.reset(canDeliver)
    }
    if (method === 'permissionsOpen') {
      if (Object.keys(params).some(key => key !== 'id')) throw new JavisError('invalid_argument', 'Unknown permission setup parameter')
      const id = params.id
      if (id !== undefined && id !== 'accessibility' && id !== 'screenshots') {
        throw new JavisError('invalid_argument', 'Permission ID must be accessibility or screenshots')
      }
      await permissions.open(id as PermissionId | undefined, canDeliver)
      return { opened: true, permissionId: id ?? null }
    }
    return computer(method, params)
  }
}
