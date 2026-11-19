import { expect, test } from 'vitest'
import { createDaemonDispatch } from '../../../src/runtime/daemon-dispatch.js'

const permissions = { status: async () => ({}), open: async () => ({}), reset: async () => ({}) }

test('routes a browser field edit through the browser contract instead of desktop input', async () => {
  const dispatch = createDaemonDispatch(async () => { throw new Error('Desktop input must not receive a browser edit') }, permissions,
    async (method, params) => ({ method, params }))
  await expect(dispatch('browser.fill', { page: 'page-one', element: '@e3', value: '' })).resolves.toEqual({
    method: 'browser.fill', params: { page: 'page-one', element: '@e3', value: '' }
  })
})

test('rejects invalid browser URL guarding before delivering the request', async () => {
  const dispatch = createDaemonDispatch(async () => ({}), permissions, async () => { throw new Error('Invalid request reached browser') })
  await expect(dispatch('browser.click', { element: '@e3', expectUrl: 'relative/path' })).rejects.toMatchObject({ code: 'invalid_argument' })
})

test('does not deliver a browser request after its caller disconnects', async () => {
  const dispatch = createDaemonDispatch(async () => ({}), permissions, async () => { throw new Error('Disconnected caller reached browser') })
  await expect(dispatch('browser.goto', { page: 'page-one', url: 'https://example.com/' }, () => false)).rejects.toMatchObject({ code: 'action_timeout' })
})
