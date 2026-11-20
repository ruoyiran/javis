import { expect, test } from 'vitest'
import { DesktopScriptSnapshotStore } from '../../src/runtime/desktop-script-provider/snapshot-store.js'
import { readSubtreeSnapshot } from '../../src/runtime/desktop-script-provider/subtree-snapshot.js'

test('subtree observations retain the window indexes of their controls', async () => {
  const store = new DesktopScriptSnapshotStore()
  const app = { name: 'Fixture', pid: 20 }
  const group = { index: 7, runtimeId: ['group'], name: 'Fields', controlType: 'group' }
  const field = { index: 8, runtimeId: ['field'], name: 'Message', controlType: 'text' }
  store.remember('Fixture', { app, windowId: 1, elements: [group, field] }, { session: 'scope' })
  const result = await readSubtreeSnapshot(store, async request => {
    if (request.root?.index !== 7 || request.windowId !== 1) throw new Error('Wrong provider subtree target')
    return { ok: true, snapshot: { app, windowId: 1, elements: [{ ...group, index: 0 }, { ...field, index: 1 }], treeLines: ['0 group Fields', '\t1 text Message'], focusedElementId: 1 } }
  }, { app: 'Fixture', rootElementIndex: 7, params: { session: 'scope', noScreenshot: true } })
  expect(result.snapshot.rootElementIndex).toBe(7)
  expect(result.snapshot.focusedElementId).toBe(8)
  expect(result.snapshot.treeText).toContain('7 group Fields\n\t8 text Message')
})
