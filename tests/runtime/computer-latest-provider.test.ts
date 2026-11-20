import { expect, test } from 'vitest'
import { SessionRuntime } from '../../src/runtime/session.js'
import { validateComputerRequestParams } from '../../src/runtime/computer-request-validation.js'
import { validateComputerProviderActionParams } from '../../src/runtime/computer-provider-action-validation.js'
import { mapBridgeError } from '../../src/runtime/desktop-script-provider/bridge.js'

test('launches a closed app without requiring an observation session', async () => {
  const runtime = new SessionRuntime(async (method, params) => {
    if (method !== 'launchApp' || params.app !== 'Fixture' || params.activate !== false) throw new Error('Wrong launch request')
    return { app: { name: 'Fixture', bundleId: 'fixture.app', pid: 20 }, launched: true, delivery: 'background' }
  })
  await expect(runtime.call('launchApp', { app: 'Fixture', activate: false })).resolves.toEqual({
    app: { name: 'Fixture', bundleId: 'fixture.app', pid: 20 }, launched: true, delivery: 'background'
  })
})

test.each([{ screenshotScale: 0 }, { screenshotMaxEdge: 1.5 }, { screenshotFormat: 'gif' }, { rootElementIndex: -1 }])('rejects invalid observation parameters before provider delivery: %j', params => {
  expect(() => validateComputerRequestParams('getAppState', { app: 'Fixture', ...params })).toThrow()
})

test('requires explicit opt-in before a system shortcut can be delivered', async () => {
  await expect(validateComputerProviderActionParams('hotkey', { app: 'Fixture', key: 'CmdOrCtrl+Q' }, 'darwin')).rejects.toMatchObject({ code: 'system_shortcut_blocked' })
  await expect(validateComputerProviderActionParams('hotkey', { app: 'Fixture', key: 'CmdOrCtrl+Q', allowSystemShortcut: true }, 'darwin')).resolves.toBe('Fixture')
})

test('refuses targeted typing when a provider would ignore the element index', async () => {
  const runtime = new SessionRuntime(async method => {
    if (method === 'handshake') return { supports: { actions: { typeText: true } } }
    if (method !== 'getAppState') throw new Error('Unsupported target reached input delivery')
    return { snapshot: { id: 's1', app: { pid: 1 }, window: { id: 1 }, treeText: '0 AXTextField' } }
  })
  await runtime.call('getAppState', { app: 'Fixture', sessionId: 'same' })
  await expect(runtime.call('typeText', { app: 'Fixture', sessionId: 'same', elementIndex: 0, text: 'value' })).rejects.toMatchObject({ code: 'unsupported_capability' })
})

test('does not describe an old provider full-window read as a subtree', async () => {
  const runtime = new SessionRuntime(async () => ({ snapshot: { id: 's1', app: { pid: 1 }, window: { id: 1 }, treeText: '0 AXTextField' } }))
  await expect(runtime.call('getAppState', { app: 'Fixture', sessionId: 'same', rootElementIndex: 0 })).rejects.toMatchObject({ code: 'unsupported_capability' })
})

test('an unreceived observation cannot authorize input in its context', async () => {
  const runtime = new SessionRuntime(async () => ({ snapshot: { id: 's1', app: { pid: 1 }, window: { id: 1 }, treeText: '0 AXButton' } }))
  await runtime.call('getAppState', { app: 'Fixture', worktree: 'discarded' })
  await runtime.call('getAppState', { app: 'Fixture', sessionId: 'retained' })
  runtime.invalidateObservation({ worktree: 'discarded' })
  await expect(runtime.call('click', { app: 'Fixture', worktree: 'discarded', elementIndex: 0 })).rejects.toMatchObject({ code: 'stale_snapshot' })
  await expect(runtime.call('click', { app: 'Fixture', sessionId: 'retained', elementIndex: 0 })).resolves.toMatchObject({ sessionId: 'retained', snapshot: { id: 's1' } })
})

test.each([
  ['window_not_responding: the target stopped after delivery', 'action_timeout'],
  ['app_launch_failed: the app exited', 'app_launch_failed'],
  ['target_elevated: the window is protected', 'permission_denied']
])('preserves the native failure category: %s', (message, code) => {
  expect(mapBridgeError(message).code).toBe(code)
})
