import { expect, test, vi } from 'vitest'
import type { BrowserStream } from '../../../src/browser/remote/framed-channel.js'

const hooks = vi.hoisted(() => ({ connect: undefined as unknown as () => Promise<BrowserStream> }))
vi.mock('../../../src/runtime/remote-stdio.js', () => ({ connectRemoteJavisBrowserStream: () => hooks.connect() }))
vi.mock('../../../src/browser/runtime/browser-process.js', () => ({ callBrowser: async () => ({ accepted: true }) }))
import { BrowserHostSubscriptions } from '../../../src/browser/remote/host-subscriptions.js'

test('cancelling a pending host subscription closes its eventual SSH resource without starting a route', async () => {
  let resolve!: (connection: BrowserStream) => void
  hooks.connect = () => new Promise(connection => resolve = connection)
  const terminal: unknown[] = []
  const subscriptions = new BrowserHostSubscriptions()
  const opening = subscriptions.accept({ method: 'browser.host.subscribe', params: { id: 'network-1', target: 'fixture-ssh', method: 'network.browserTunnel', params: {} } })
  await subscriptions.accept({ method: 'browser.host.unsubscribe', params: { id: 'network-1' } })
  resolve({ close: () => terminal.push({ type: 'closed', host: 'fixture-ssh' }), call: async () => { throw new Error('Cancelled route must not be started') } })
  await opening
  expect(terminal).toEqual([{ type: 'closed', host: 'fixture-ssh' }])
  subscriptions.close()
})
