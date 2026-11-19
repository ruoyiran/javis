import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import { chromium } from 'playwright-core'
import { startMobileGateway } from '../../../src/mobile/gateway.js'
import type { BrowserStreamOptions } from '../../../src/browser/remote/framed-channel.js'
import { encodeBrowserScreencastFrame, BrowserScreencastOpcode } from '../../../src/browser/source/shared/browser/screencast/browser-screencast-protocol.js'

const executable = process.env.JAVIS_TEST_CHROMIUM ?? chromium.executablePath()
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')

test.skipIf(!existsSync(executable))('served phone CSP decodes and acknowledges live images and clears page-A input when selecting page B', async () => {
  let options!: BrowserStreamOptions
  let acknowledge!: (params: Record<string, unknown>) => void
  const ack = new Promise<Record<string, unknown>>(resolve => acknowledge = resolve)
  const gateway = await startMobileGateway({ bind: '127.0.0.1', port: 0, call: async () => ({ apps: [] }), browserConnect: async input => {
    options = input
    return { close() {}, call: async (method, params) => {
      if (method === 'browser.tabList') return { tabs: [{ browserPageId: 'page-a', url: 'https://fixture.test/a' }, { browserPageId: 'page-b', url: 'https://fixture.test/b' }] }
      if (method === 'browser.snapshot') return { snapshot: 'button Submit' }
      if (method === 'browser.eval') return { result: JSON.stringify({ url: 'https://fixture.test/' + (params.page === 'page-b' ? 'b' : 'a'), width: 390, height: 844 }) }
      if (method === 'browser.screencast') {
        const ready = { type: 'ready', browserPageId: 'page-a', subscriptionId: 'stream-a' }
        options.onEvent({ method, params: ready })
        const bytes = encodeBrowserScreencastFrame({ opcode: BrowserScreencastOpcode.Frame, seq: 1, format: 'png', metadata: { deviceWidth: 390, deviceHeight: 844 }, image })
        options.onEvent({ method: 'browser.stream.binary', params: { method, subscriptionId: 'stream-a', bytes: Buffer.from(bytes).toString('base64') } })
        return ready
      }
      if (method === 'browser.screencast.ack') { acknowledge(params); return { credited: true } }
      if (method === 'browser.screencast.unsubscribe') return { unsubscribed: true }
      throw new Error('Input must not target a page from a retained image')
    } }
  } })
  const browser = await chromium.launch({ executablePath: executable, headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  try {
    await page.goto(gateway.url)
    await page.locator('#pair-panel').waitFor({ state: 'visible' })
    await page.locator('#pair-code').fill(gateway.pairingCode)
    await page.locator('#pair-form').evaluate((form: HTMLFormElement) => form.requestSubmit())
    await page.locator('#workspace').waitFor({ state: 'visible' })
    await page.locator('#browser-pages-refresh').click()
    await page.waitForFunction(() => (document.getElementById('browser-pages') as HTMLSelectElement).options.length === 2)
    await page.locator('#browser-stream').click()
    await expect(ack).resolves.toEqual({ subscriptionId: 'stream-a', seq: 1 })
    expect(await page.locator('#browser-frame').evaluate((image: HTMLImageElement) => ({ decoded: image.complete, width: image.naturalWidth, hidden: image.hidden }))).toEqual({ decoded: true, width: 1, hidden: false })
    await page.locator('#browser-pages').selectOption('page-b')
    await page.waitForFunction(() => (document.getElementById('browser-address') as HTMLInputElement).value === 'https://fixture.test/b')
    expect(await page.locator('#browser-frame').evaluate((image: HTMLImageElement) => ({ hidden: image.hidden, source: image.getAttribute('src') }))).toEqual({ hidden: true, source: null })
    await page.locator('#browser-frame').evaluate(image => image.dispatchEvent(new MouseEvent('click', { clientX: 30, clientY: 50 })))
    expect(await page.locator('#browser-address').inputValue()).toBe('https://fixture.test/b')
  } finally { await browser.close(); await gateway.close() }
}, 30_000)
