import { expect, test } from 'vitest'
import { MobileBrowserSession } from '../../../src/mobile/browser-session.js'

test('phone actions pin observed page, context and URL; uncertain delivery blocks subsequent input', async () => {
  const forwarded: unknown[] = []
  const browser = new MobileBrowserSession(async () => ({
    close() {},
    async call(method, params) {
      if (method === 'browser.eval') return { result: '{"url":"https://fixture.test/","width":400,"height":800}', origin: 'https://fixture.test' }
      if (method === 'browser.tabList') return { tabs: [{ browserPageId: 'page-phone', profileId: 'profile-phone' }] }
      if (method === 'browser.screencast.unsubscribe') return { unsubscribed: true }
      if (method === 'browser.snapshot') return { snapshot: 'button Submit' }
      forwarded.push({ method, params })
      throw new Error('Connection closed')
    }
  }))
  browser.target = { page: 'page-phone', worktree: 'cwd:/fixture', sessionId: 'session-phone', profileId: 'profile-phone', url: '', width: 0, height: 0, observedAt: 0 }
  await browser.observe()
  await expect(browser.act('browser.click', { element: '@e1' })).rejects.toThrow('Connection closed')
  expect(forwarded).toEqual([{ method: 'browser.click', params: { element: '@e1', page: 'page-phone', worktree: 'cwd:/fixture', expectUrl: 'https://fixture.test/' } }])
  await expect(browser.act('browser.type', { input: 'again' })).rejects.toThrow('Refresh before acting')
  await browser.observe()
  await expect(browser.act('browser.click', { element: '@e2', page: 'other' })).rejects.toThrow('Invalid mobile browser action')
  await expect(browser.act('browser.mouseClick', { x: 400, y: 100 })).rejects.toThrow('outside observed geometry')
  browser.close()
})

import type { BrowserStream, BrowserStreamOptions } from '../../../src/browser/remote/framed-channel.js'
import { encodeBrowserScreencastFrame, BrowserScreencastOpcode } from '../../../src/browser/source/shared/browser/screencast/browser-screencast-protocol.js'

test('closing during connection startup rejects delivery and closes the late connection', async () => {
  let resolve!: (stream: BrowserStream) => void
  const browser = new MobileBrowserSession(() => new Promise(connection => resolve = connection))
  const terminal: string[] = []
  const operation = browser.call('browser.type', { input: 'must not be delivered' })
  browser.close()
  resolve({ close: () => terminal.push('closed'), call: async () => { throw new Error('Delivered after close') } })
  await expect(operation).rejects.toThrow('closed before delivery')
  expect(terminal).toEqual(['closed'])
})

test('stream geometry and displayed-page ownership invalidate coordinate input on the server', async () => {
  let options!: BrowserStreamOptions
  const browser = new MobileBrowserSession(async input => {
    options = input
    return { close() {}, call: async method => {
      if (method === 'browser.screencast') { options.onEvent({ method, params: { type: 'ready', browserPageId: 'page-a', subscriptionId: 'stream-a' } }); return { subscriptionId: 'stream-a' } }
      if (method === 'browser.screencast.unsubscribe') return { unsubscribed: true }
      if (method === 'browser.snapshot') return { snapshot: 'button Submit' }
      if (method === 'browser.eval') return { result: '{"url":"https://fixture.test/","width":400,"height":800}' }
      throw new Error('Stale input reached the browser')
    } }
  })
  await browser.select({ page: 'page-a', worktree: 'default', sessionId: 'session-a', url: '', width: 0, height: 0, observedAt: 0 })
  await browser.startStream({ width: 400, height: 800 })
  await browser.observe()
  const bytes = encodeBrowserScreencastFrame({ opcode: BrowserScreencastOpcode.Frame, seq: 4, format: 'png', metadata: { deviceWidth: 200, deviceHeight: 400 }, image: new Uint8Array([1]) })
  options.onEvent({ method: 'browser.stream.binary', params: { method: 'browser.screencast', subscriptionId: 'stream-a', bytes: Buffer.from(bytes).toString('base64') } })
  await expect(browser.act('browser.mouseClick', { x: 300, y: 600 }, { subscriptionId: 'stream-a', seq: 4 })).rejects.toThrow('Refresh before acting')
  await browser.select({ page: 'page-b', worktree: 'default', sessionId: 'session-b', url: '', width: 0, height: 0, observedAt: 0 })
  await browser.observe()
  await expect(browser.act('browser.mouseClick', { x: 50, y: 100 }, { subscriptionId: 'stream-a', seq: 4 })).rejects.toThrow('displayed browser frame')
  browser.close()
})

test('a disconnected observation cannot reopen a channel or restore action freshness', async () => {
  let resolve!: (snapshot: unknown) => void
  const browser = new MobileBrowserSession(async () => ({ close() {}, call: method => {
    if (method === 'browser.snapshot') return new Promise(snapshot => resolve = snapshot)
    throw new Error('Cancelled observation reached another browser request')
  } }))
  browser.target = { page: 'page-a', worktree: 'default', sessionId: 'session-a', url: '', width: 0, height: 0, observedAt: 0 }
  const observation = browser.observe()
  await new Promise<void>(finished => setImmediate(finished))
  browser.close(); resolve({ snapshot: 'button Submit' })
  await expect(observation).rejects.toThrow('observation was cancelled')
  await expect(browser.act('browser.type', { input: 'unsafe' })).rejects.toThrow('Refresh before acting')
})
