import { afterEach, expect, test, vi } from 'vitest'
import { waitForComputer } from '../../src/cli/computer-wait.js'

const snapshot = (id: string, disabled: number[]) => ({
  snapshot: {
    id, app: { name: 'Fixture', bundleId: 'test.fixture', pid: 12 },
    window: { id: 7, index: 0, title: 'Fixture', width: 200, height: 100 },
    coordinateSpace: 'window', treeText: 'Fixture\n\n0 window Fixture\n\t1 button Continue\n\t2 button Continue',
    elementCount: 3, focusedElementId: null, disabledElementIndexes: disabled
  }, screenshot: null, screenshotStatus: { state: 'skipped', reason: 'no_screenshot_flag' }
})
afterEach(() => vi.useRealTimers())

test('waits until every matching control is enabled and returns the successful observation', async () => {
  const states = [snapshot('disabled', [1]), snapshot('ready', [])]
  const result = await waitForComputer({ app: 'Fixture', condition: { kind: 'enabled', value: 'continue' }, timeoutMs: 1000 }, { context: 'context-one' }, async (method, params) => {
    if (method === 'capabilities') return { supports: { observation: { disabledState: true } } }
    if (method !== 'getAppState' || params.noScreenshot !== true || params.app !== 'Fixture') throw new Error('Wrong observation mode')
    return states.shift() ?? snapshot('ready', [])
  })
  expect((result.snapshot as { id: string }).id).toBe('ready')
  expect(result.wait).toMatchObject({ kind: 'enabled', value: 'continue' })
})

test('refuses enabled waits on providers that cannot report disabled controls', async () => {
  await expect(waitForComputer({ app: 'Fixture', condition: { kind: 'enabled', value: 'Continue' } }, {}, async () => ({ supports: { observation: { disabledState: false } } }))).rejects.toMatchObject({ code: 'unsupported_capability' })
})

test('returns only matching window titles and rejects a window selector for that condition', async () => {
  const call = async () => ({ app: { name: 'Fixture', bundleId: null, pid: 12 }, windows: [{ index: 0, title: 'Loading', width: 200, height: 100 }, { index: 1, title: 'Ready Document', width: 200, height: 100 }] })
  const result = await waitForComputer({ app: 'Fixture', condition: { kind: 'window-title', value: 'READY' } }, {}, call)
  expect(result.windows).toEqual([{ index: 1, title: 'Ready Document', width: 200, height: 100 }])
  await expect(waitForComputer({ app: 'Fixture', windowIndex: 0, condition: { kind: 'window-title', value: 'Ready' } }, {}, call)).rejects.toMatchObject({ code: 'invalid_argument' })
})

test('fails with wait_timeout when no observation meets the condition', async () => {
  vi.useFakeTimers()
  const result = waitForComputer({ app: 'Fixture', condition: { kind: 'text', value: 'Absent' }, timeoutMs: 500 }, {}, async () => snapshot('unchanged', []))
  const failed = expect(result).rejects.toMatchObject({ code: 'wait_timeout' })
  await vi.runAllTimersAsync()
  await failed
})
