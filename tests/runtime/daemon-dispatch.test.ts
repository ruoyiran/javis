import { expect, test, vi } from 'vitest'
import { createDaemonDispatch } from '../../src/runtime/daemon-dispatch.js'

test('runs permission status and reset in the daemon process', async () => {
  const status = vi.fn(async () => ({ platform: 'darwin', permissions: [{ id: 'accessibility', status: 'granted' }] }))
  const reset = vi.fn(async () => ({ platform: 'darwin', permissions: [{ id: 'accessibility', status: 'not-granted' }] }))
  const computer = vi.fn(async () => ({}))
  const dispatch = createDaemonDispatch(computer, { status, open: async () => {}, reset })
  expect(await dispatch('permissionsStatus', {})).toEqual({ platform: 'darwin', permissions: [{ id: 'accessibility', status: 'granted' }] })
  expect(await dispatch('permissionsReset', {})).toEqual({ platform: 'darwin', permissions: [{ id: 'accessibility', status: 'not-granted' }] })
  expect(status).toHaveBeenCalledOnce()
  expect(reset).toHaveBeenCalledOnce()
  expect(computer).not.toHaveBeenCalled()
})

test('rejects an invalid permission setup ID before opening UI', async () => {
  const open = vi.fn(async () => {})
  const dispatch = createDaemonDispatch(async () => ({}), { status: async () => ({}), open, reset: async () => ({}) })
  await expect(dispatch('permissionsOpen', { id: 'unknown' })).rejects.toMatchObject({ code: 'invalid_argument' })
  expect(open).not.toHaveBeenCalled()
})

test('preserves detailed permission setup status alongside legacy open fields', async () => {
  const setup = {
    platform: 'darwin', helperAppPath: '/Applications/Javis.app', permissionId: 'screenshots',
    launchedHelper: false, openedSettings: false,
    permissions: [{ id: 'accessibility', status: 'granted' }, { id: 'screenshots', status: 'granted' }], nextStep: null
  }
  const dispatch = createDaemonDispatch(async () => ({}), { status: async () => ({}), open: async () => setup, reset: async () => ({}) })
  expect(await dispatch('permissionsOpen', { id: 'screenshots' })).toEqual({ opened: true, ...setup })
})
