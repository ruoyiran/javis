import { expect, test } from 'vitest'
import { DesktopScriptSnapshotStore } from '../../src/runtime/desktop-script-provider/snapshot-store.js'
import { readSubtreeSnapshot } from '../../src/runtime/desktop-script-provider/subtree-snapshot.js'

test('reads an observed valid explicit window absent from the current main-window list', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const group = { index: 7, runtimeId: ['group'], name: 'Fields', controlType: 'group' }
  store.remember('Fixture', { app, windowId: 202, elements: [group] }, { session: 'scope' })
  const result = await readSubtreeSnapshot(store, async request => {
    if (request.tool === 'list_windows') return { ok: true, app, windows: [{ app, id: 101, index: 0, title: 'Main', width: 100, height: 100 }] }
    if (request.windowId !== 202) throw new Error('The cached explicit target was replaced by the main window')
    if (!request.root) {
      if (request.app !== 'Fixture' || request.noScreenshot !== true || request.restoreWindow === true) throw new Error('The target probe changed focus or app selection')
      return { ok: true, snapshot: { app, windowId: 202 } }
    }
    if (request.app !== 'pid:20') throw new Error('The subtree app process was not pinned')
    return { ok: true, snapshot: { app, windowId: 202, subtreeRoot: { ...group, index: 0 }, elements: [{ ...group, index: 0 }], treeLines: ['0 group Fields'] } }
  }, { app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', windowId: 202, noScreenshot: true } })
  expect(result.snapshot.window.id).toBe(202)
  expect(result.snapshot.rootElementIndex).toBe(7)
})

test('a target-ID probe cannot silently substitute a different window', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const group = { index: 7, runtimeId: ['group'], name: 'Fields', controlType: 'group' }
  store.remember('Fixture', { app, windowId: 202, elements: [group] }, { session: 'scope' })
  await expect(readSubtreeSnapshot(store, async request => {
    if (request.root) throw new Error('An unverified window reached root delivery')
    return { ok: true, snapshot: { app, windowId: 101 } }
  }, { app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', windowId: 202, noScreenshot: true } })).rejects.toMatchObject({ code: 'window_stale' })
})

test('does not certify a full-window reply as a non-window subtree', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const window = { index: 0, runtimeId: ['window'], name: 'Window', controlType: 'window' }
  const group = { index: 7, runtimeId: ['group'], name: 'Fields', controlType: 'group' }
  const full = { app, windowId: 1, windowIndex: 0, elements: [window, group], treeLines: ['0 window Window', '\t7 group Fields'] }
  store.remember('Fixture', full, { session: 'scope' })
  await expect(readSubtreeSnapshot(store, async () => ({ ok: true, snapshot: full }), {
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
    if (!request.root) return { ok: true, snapshot: { app, windowId: 1 } }
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
    if (!request.root) return { ok: true, snapshot: { app, windowId: 101 } }
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
    if (!request.root) return { ok: true, snapshot: { app, windowId: 1 } }
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
    if (request.root) throw new Error('A stale app handle reached the provider')
    return { ok: true, snapshot: { app: { ...app, pid: 21 }, windowId: 1 } }
  }, { app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', noScreenshot: true } })).rejects.toMatchObject({ code: 'window_stale' })
})
