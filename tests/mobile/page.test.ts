import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import { mobileJavaScript } from '../../src/mobile/page.js'

type Listener = (event: { preventDefault: () => void }) => unknown

type FakeElement = {
  hidden: boolean
  disabled: boolean
  checked: boolean
  value: string
  textContent: string
  src: string
  dataset: { action: string }
  children: FakeElement[]
  entries: [string, string][]
  addEventListener: (name: string, listener: Listener) => void
  dispatch: (name: string) => unknown
  replaceChildren: () => void
  append: (child: FakeElement) => void
  removeAttribute: (name: string) => void
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
}

function element(): FakeElement {
  const listeners = new Map<string, Listener>()
  return {
    hidden: true, disabled: false, checked: false, value: '', textContent: '', src: '',
    dataset: { action: 'click' }, children: [] as FakeElement[],
    entries: [['elementIndex', '1']] as [string, string][],
    addEventListener(name: string, listener: Listener) { listeners.set(name, listener) },
    dispatch(name: string) { return listeners.get(name)?.({ preventDefault() {} }) },
    replaceChildren() { this.children = []; this.value = '' },
    append(child: FakeElement) { this.children.push(child); if (this.children.length === 1) this.value = child.value },
    removeAttribute(name: string) { if (name === 'src') this.src = '' },
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 200 } }
  }
}

test('an uncertain action disables phone controls until a fresh observation', async () => {
  const ids = new Map<string, FakeElement>()
  const get = (id: string) => {
    if (!ids.has(id)) ids.set(id, element())
    return ids.get(id)!
  }
  const form = element()
  const actionButton = element()
  const document = {
    getElementById: get,
    querySelectorAll: (selector: string) => selector === '[data-action]' ? [form] : [actionButton],
    createElement: element
  }
  let actionCalls = 0
  const fetch = async (path: string) => {
    if (path === '/api/action') { actionCalls++; throw new Error('Connection closed') }
    const value = path === '/api/session' ? { csrfToken: 'csrf' }
      : path === '/api/apps' ? { apps: [{ name: 'Fixture', bundleId: 'example.fixture', pid: 7 }] }
        : path.startsWith('/api/windows') ? { windows: [] }
          : { snapshot: { treeText: '0 window' }, screenshot: null }
    return { ok: true, json: async () => value }
  }
  runInNewContext(mobileJavaScript, {
    document, fetch, AbortSignal, FormData: class { constructor(readonly target: FakeElement) {} *[Symbol.iterator]() { yield* this.target.entries } },
    crypto: { randomUUID: () => 'request-1' }, String, Number, Array, Object, Boolean, Error, encodeURIComponent
  })
  await new Promise(resolve => setImmediate(resolve))
  await get('observe-button').dispatch('click')
  expect(actionButton.disabled).toBe(false)
  form.dispatch('submit')
  await new Promise(resolve => setImmediate(resolve))
  expect(actionCalls).toBe(1)
  expect(actionButton.disabled).toBe(true)
  expect(get('delivery-warning').hidden).toBe(false)
  form.dispatch('submit')
  await new Promise(resolve => setImmediate(resolve))
  expect(actionCalls).toBe(1)
  await get('observe-button').dispatch('click')
  expect(actionButton.disabled).toBe(false)
})
