import { afterEach, expect, it, vi } from 'vitest'
import { captureRuntimeEnvironmentCall } from '../../../src/browser/source/renderer/src/runtime/web-session-tabs-sync/identity/web-runtime-session-environment'
import { replaceRuntimeEnvironmentRevisions } from '../../../src/browser/source/renderer/src/runtime/rpc/environment-revisions/runtime-environment-revision'

afterEach(() => {
  replaceRuntimeEnvironmentRevisions([])
  vi.unstubAllGlobals()
})

it('delivers client-page controls and their recovery census through the browser-only Javis host transport', async () => {
  replaceRuntimeEnvironmentRevisions([{ id: 'host-b', createdAt: 1, pairingRevision: 7 }])
  vi.stubGlobal('window', {
    api: {
      javisBrowser: {},
      runtimeEnvironments: {
        invoke: async ({
          selector,
          method,
          params
        }: {
          selector: string
          method: string
          params: unknown
        }) => {
          if (selector !== 'host-b') throw new Error('Unexpected host')
          if (method === 'browser.clientPage.initializationAction') {
            expect(params).toEqual({
              worktree: 'id:context-b',
              page: 'remote-page-b',
              expectedPlacement: {
                kind: 'client',
                browserHostClientId: 'client-a',
                browserHostGeneration: 2,
                pageHostGeneration: 3
              },
              action: { type: 'stop' }
            })
            return {
              ok: true,
              result: {
                worktree: 'context-b',
                publicationEpoch: 'real-runtime-b',
                snapshotVersion: 2,
                activeGroupId: null,
                activeTabId: null,
                activeTabType: null,
                tabs: []
              },
              _meta: { runtimeId: 'real-runtime-b' }
            }
          }
          if (method === 'browser.workspaceSnapshot') {
            expect(params).toEqual({ worktree: 'id:context-b' })
            return {
              ok: true,
              result: {
                worktree: 'context-b',
                publicationEpoch: 'real-runtime-b',
                snapshotVersion: 3,
                activeGroupId: null,
                activeTabId: null,
                activeTabType: null,
                tabs: []
              },
              _meta: { runtimeId: 'real-runtime-b' }
            }
          }
          throw new Error('Unexpected browser method')
        }
      }
    }
  })
  const call = captureRuntimeEnvironmentCall('host-b')
  expect(
    await call({
      method: 'browser.clientPage.initializationAction',
      params: {
        worktree: 'id:context-b',
        page: 'remote-page-b',
        expectedPlacement: {
          kind: 'client',
          browserHostClientId: 'client-a',
          browserHostGeneration: 2,
          pageHostGeneration: 3
        },
        action: { type: 'stop' }
      }
    })
  ).toEqual({
    ok: true,
    result: {
      worktree: 'context-b',
      publicationEpoch: 'real-runtime-b',
      snapshotVersion: 2,
      activeGroupId: null,
      activeTabId: null,
      activeTabType: null,
      tabs: []
    },
    _meta: { runtimeId: 'real-runtime-b' }
  })
  expect(await call({ method: 'session.tabs.list', params: { worktree: 'id:context-b' } })).toEqual(
    {
      ok: true,
      result: {
        worktree: 'context-b',
        publicationEpoch: 'real-runtime-b',
        snapshotVersion: 3,
        activeGroupId: null,
        activeTabId: null,
        activeTabType: null,
        tabs: []
      },
      _meta: { runtimeId: 'real-runtime-b' }
    }
  )
})

it('rejects a captured client-page control after its host pairing changes', async () => {
  replaceRuntimeEnvironmentRevisions([{ id: 'host-b', createdAt: 1, pairingRevision: 7 }])
  const call = captureRuntimeEnvironmentCall('host-b')
  replaceRuntimeEnvironmentRevisions([{ id: 'host-b', createdAt: 1, pairingRevision: 8 }])
  vi.stubGlobal('window', {
    api: {
      javisBrowser: {},
      runtimeEnvironments: {
        invoke: async () => ({ ok: true, result: 'delivered-to-replacement' }),
        call: async () => ({ ok: true, result: 'delivered-to-replacement' })
      }
    }
  })
  await expect(
    call({
      method: 'browser.clientPage.initializationAction',
      params: {
        page: 'remote-page-b',
        expectedPlacement: {
          kind: 'client',
          browserHostClientId: 'client-a',
          browserHostGeneration: 2,
          pageHostGeneration: 3
        },
        action: { type: 'stop' }
      }
    })
  ).rejects.toThrow('Runtime environment pairing changed')
})
