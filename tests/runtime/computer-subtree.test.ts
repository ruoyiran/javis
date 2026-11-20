import { expect, test } from 'vitest'
import { DesktopScriptSnapshotStore } from '../../src/runtime/desktop-script-provider/snapshot-store.js'
import { readSubtreeSnapshot } from '../../src/runtime/desktop-script-provider/subtree-snapshot.js'

test('does not certify a full-window reply as a non-window subtree', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const window = { index: 0, runtimeId: ['window'], name: 'Window', controlType: 'window' }
  const group = { index: 7, runtimeId: ['group'], name: 'Fields', controlType: 'group' }
  const full = { app, windowId: 1, windowIndex: 0, elements: [window, group], treeLines: ['0 window Window', '\t7 group Fields'] }
  store.remember('Fixture', full, { session: 'scope' })
  await expect(readSubtreeSnapshot(store, async request => request.tool === 'list_windows' ? { ok: true, app, windows: [{ index: 0, id: 1, app, title: 'Window', width: 100, height: 100 }] } : ({ ok: true, snapshot: full }), {
    app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', noScreenshot: true }
  })).rejects.toMatchObject({ code: 'unsupported_capability' })
})

test('cannot use another app window-index cache to deliver a subtree request', async () => {
  const store = new DesktopScriptSnapshotStore()
  const group = { index: 7, runtimeId: [0, 0], name: 'Fields', controlType: 'group' }
  store.remember('AppB', { app: { name: 'AppB', pid: 200 }, windowIndex: 0, elements: [group] }, { session: 'scope', windowIndex: 0 })
  await expect(readSubtreeSnapshot(store, async () => ({ ok: true, snapshot: {
    app: { name: 'AppA', pid: 100 }, windowIndex: 0, elements: [{ ...group, index: 0 }], treeLines: ['0 group Fields']
  } }), { app: 'AppA', rootElementIndex: 7, params: { session: 'scope', windowIndex: 0, noScreenshot: true } })).rejects.toMatchObject({ code: 'element_not_found' })
})

test('subtree observations retain the window indexes of their controls', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const group = { index: 7, runtimeId: ['group'], name: 'Fields', controlType: 'group' }
  const field = { index: 8, runtimeId: ['field'], name: 'Message', controlType: 'text' }
  store.remember('Fixture', { app, windowId: 1, elements: [group, field] }, { session: 'scope' })
  const result = await readSubtreeSnapshot(store, async request => {
    if (request.tool === 'list_windows') return { ok: true, app, windows: [{ index: 0, id: 1, app, title: 'Fixture', width: 100, height: 100 }] }
    if (request.root?.index !== 7 || request.windowId !== 1) throw new Error('Wrong provider subtree target')
    return { ok: true, snapshot: { app, windowId: 1, elements: [{ ...group, index: 0 }, { ...field, index: 1 }], treeLines: ['0 group Fields', '\t1 text Message'], focusedElementId: 1 } }
  }, { app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', noScreenshot: true } })
  expect(result.snapshot.rootElementIndex).toBe(7)
  expect(result.snapshot.focusedElementId).toBe(8)
  expect(result.snapshot.treeText).toContain('7 group Fields\n\t8 text Message')
})

test('valid scoped reads survive another app using the same window index', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'AppA', pid: 100 }
  const group = { index: 7, runtimeId: [0, 0], name: 'Fields', controlType: 'group' }
  store.remember('AppA', { app, windowId: 101, windowIndex: 0, elements: [group] }, { session: 'scope', windowIndex: 0 })
  store.remember('AppB', { app: { name: 'AppB', pid: 200 }, windowId: 202, windowIndex: 0, elements: [group] }, { session: 'scope', windowIndex: 0 })
  const result = await readSubtreeSnapshot(store, async request => {
    if (request.tool === 'list_windows') return { ok: true, app, windows: [{ app, id: 101, index: 0, title: 'AppA', width: 100, height: 100 }] }
    if (request.app !== 'pid:100' || request.windowId !== 101) throw new Error('A foreign app supplied the subtree handle')
    return { ok: true, snapshot: { app, windowId: 101, windowIndex: 0, elements: [{ ...group, index: 0 }], treeLines: ['0 group Fields'] } }
  }, { app: 'AppA', rootElementIndex: 7, params: { session: 'scope', windowIndex: 0, noScreenshot: true } })
  expect(result.snapshot.app.pid).toBe(100)
  expect(result.snapshot.window.id).toBe(101)
  expect(result.snapshot.rootElementIndex).toBe(7)
})

test('provider root markers admit intentionally elided roots and retain their indexes', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const group = { index: 7, runtimeId: ['group'], name: '', controlType: 'panel' }
  const field = { index: 8, runtimeId: ['field'], name: 'Message', controlType: 'text' }
  store.remember('Fixture', { app, windowId: 1, windowIndex: 0, elements: [group, field] }, { session: 'scope' })
  const read = () => readSubtreeSnapshot(store, async request => {
    if (request.tool === 'list_windows') return { ok: true, app, windows: [{ app, id: 1, index: 0, title: 'Fixture', width: 100, height: 100 }] }
    if (request.root?.index !== 7) throw new Error('The elided root lost its original handle')
    return { ok: true, snapshot: { app, windowId: 1, windowIndex: 0, subtreeRoot: { ...group, index: 0 }, elements: [{ ...field, index: 0 }], treeLines: ['0 text Message'], focusedElementId: 0 } }
  }, { app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', noScreenshot: true } })
  for (const result of [await read(), await read()]) {
    expect(result.snapshot.rootElementIndex).toBe(7)
    expect(result.snapshot.focusedElementId).toBe(8)
    expect(result.snapshot.treeText).toContain('8 text Message')
  }
})

test('a restarted requested app is rejected before any cached handle is delivered', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const group = { index: 7, runtimeId: ['group'], name: 'Fields', controlType: 'group' }
  store.remember('Fixture', { app, windowId: 1, windowIndex: 0, elements: [group] }, { session: 'scope' })
  await expect(readSubtreeSnapshot(store, async request => {
    if (request.tool !== 'list_windows') throw new Error('A stale app handle reached the provider')
    return { ok: true, app: { ...app, pid: 21 }, windows: [] }
  }, { app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', noScreenshot: true } })).rejects.toMatchObject({ code: 'window_stale' })
})
