import { afterEach, expect, test, vi } from 'vitest'
import { SessionRuntime } from '../../src/runtime/session.js'
import { waitForComputer } from '../../src/cli/computer-wait.js'
import { JavisError } from '../../src/runtime/error.js'

const state = (id = 'poll') => ({
  snapshot: {
    id, app: { name: 'Fixture', bundleId: 'test.fixture', pid: 12 },
    window: { id: 7, index: 0, title: 'Fixture', width: 200, height: 100 },
    coordinateSpace: 'window', treeText: 'Fixture\n\n0 window Fixture\n\t1 button Continue',
    elementCount: 2, focusedElementId: null
  }, screenshot: null, screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' }
})
afterEach(() => vi.useRealTimers())

test.each(['timeout', 'cancelled'])('an unpublished %s wait poll cannot authorize indexed input', async failure => {
  vi.useFakeTimers()
  const runtime = new SessionRuntime(async method => {
    if (method === 'handshake') return { supports: { observation: {} } }
    if (method !== 'getAppState') throw new Error('Native input must not be reached')
    return state()
  })
  await runtime.call('getAppState', { app: 'Fixture', worktree: 'folder' })
  let polled = false
  const waiting = waitForComputer({ app: 'Fixture', condition: { kind: 'text', value: 'Absent' }, timeoutMs: 500 }, { context: 'folder' }, async (method, params, target, options) => {
    if (method === 'getAppState' && polled && failure === 'cancelled') throw new JavisError('transport_error', 'Read was cancelled')
    if (method === 'getAppState') polled = true
    return runtime.call(method, target.context === undefined ? params : { ...params, worktree: target.context }, options)
  })
  const completed = waiting.then(result => ({ result }), error => ({ error }))
  await vi.runAllTimersAsync()
  expect(await completed).toMatchObject({ error: { code: failure === 'timeout' ? 'wait_timeout' : 'transport_error' } })
  await expect(runtime.call('click', { app: 'Fixture', worktree: 'folder', elementIndex: 1 })).rejects.toMatchObject({ code: 'stale_snapshot' })
})

test('publishes exactly the matched poll, including a generated session and observation metadata', async () => {
  const runtime = new SessionRuntime(async method => {
    if (method === 'handshake') return { supports: { observation: {} } }
    if (method !== 'getAppState') throw new Error('Unexpected provider call')
    return state('matched')
  })
  const result = await waitForComputer({ app: 'Fixture', condition: { kind: 'text', value: 'continue' } }, {}, (method, params, _target, options) => runtime.call(method, params, options))
  expect(result).toMatchObject({ snapshot: { id: 'matched', window: { id: 7 } }, screenshot: null, screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' }, sessionId: expect.any(String) })
  await expect(runtime.call('click', { app: 'Fixture', sessionId: result.sessionId, elementIndex: 1 })).rejects.toThrow('Unexpected provider call')
})

test('rejects publication after a replacement observation or a changed context or target', async () => {
  const runtime = new SessionRuntime(async () => state())
  const params = { app: 'Fixture', worktree: 'folder', noScreenshot: true, treeDiff: false }
  await runtime.call('getAppState', params, { observation: { mode: 'stage', token: 'first' } })
  await expect(runtime.call('getAppState', { ...params, worktree: 'other' }, { observation: { mode: 'publish', token: 'first' } })).rejects.toMatchObject({ code: 'stale_snapshot' })
  await expect(runtime.call('getAppState', { ...params, windowId: 8 }, { observation: { mode: 'publish', token: 'first' } })).rejects.toMatchObject({ code: 'stale_snapshot' })
  await runtime.call('getAppState', params, { observation: { mode: 'stage', token: 'second' } })
  await expect(runtime.call('getAppState', params, { observation: { mode: 'publish', token: 'first' } })).rejects.toMatchObject({ code: 'stale_snapshot' })
  await runtime.call('getAppState', params)
  await expect(runtime.call('getAppState', params, { observation: { mode: 'publish', token: 'second' } })).rejects.toMatchObject({ code: 'stale_snapshot' })
})

test('an expired staged observation cannot be published or authorize input', async () => {
  vi.useFakeTimers()
  const runtime = new SessionRuntime(async () => state())
  const params = { app: 'Fixture', sessionId: 'same' }
  await runtime.call('getAppState', params, { observation: { mode: 'stage', token: 'expired' } })
  await vi.advanceTimersByTimeAsync(120_001)
  await expect(runtime.call('getAppState', params, { observation: { mode: 'publish', token: 'expired' } })).rejects.toMatchObject({ code: 'stale_snapshot' })
  await expect(runtime.call('click', { ...params, elementIndex: 1 })).rejects.toMatchObject({ code: 'stale_snapshot' })
})
