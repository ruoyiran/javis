import { afterEach, expect, it, vi } from 'vitest'
import {
  callRuntimeRpc,
  callRuntimeRpcResponse
} from '../../../src/browser/source/renderer/src/runtime/rpc/calls/runtime-rpc-call'

afterEach(() => vi.unstubAllGlobals())

it('unwraps a remote Javis result once while preserving the response API envelope', async () => {
  vi.stubGlobal('window', {
    api: {
      javisBrowser: {},
      runtimeEnvironments: {
        invoke: async ({ selector, method }: { selector: string; method: string }) => {
          if (selector !== 'host-b') throw new Error('Unexpected host')
          if (method === 'browser.status')
            return { ok: true, result: { running: true, protocolVersion: 1 } }
          if (method === 'browser.eval')
            return {
              id: 'remote-request',
              ok: true,
              result: { value: 'remote-value' },
              _meta: { runtimeId: 'observed-runtime-b' }
            }
          throw new Error('Unexpected method')
        }
      }
    }
  })
  const target = { kind: 'environment', environmentId: 'host-b' } as const
  expect(await callRuntimeRpc(target, 'browser.eval', { page: 'page-b' })).toEqual({
    value: 'remote-value'
  })
  expect(await callRuntimeRpcResponse(target, 'browser.eval', { page: 'page-b' })).toEqual({
    id: 'remote-request',
    ok: true,
    result: { value: 'remote-value' },
    _meta: { runtimeId: 'observed-runtime-b' }
  })
})

it('uses the local Javis host transport instead of the Orca object-form runtime API', async () => {
  vi.stubGlobal('window', {
    api: {
      javisBrowser: {},
      runtimeEnvironments: {
        invoke: async ({ selector, method }: { selector: string; method: string }) => {
          if (selector !== 'local' || method !== 'browser.eval')
            throw new Error('Unexpected target')
          return { ok: true, result: { value: 'local-value' } }
        }
      }
    }
  })
  expect(await callRuntimeRpc({ kind: 'local' }, 'browser.eval', { page: 'local-page' })).toEqual({
    value: 'local-value'
  })
})
