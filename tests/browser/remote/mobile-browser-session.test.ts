import { expect, test } from 'vitest'
import { MobileBrowserSession } from '../../../src/mobile/browser-session.js'

test('phone actions pin observed page, context and URL; uncertain delivery blocks subsequent input', async () => {
  const forwarded: unknown[] = []
  const browser = new MobileBrowserSession(async () => ({
    close() {},
    async call(method, params) {
      if (method === 'browser.eval') return { result: '{"url":"https://fixture.test/","width":400,"height":800}', origin: 'https://fixture.test' }
      if (method === 'browser.snapshot') return { snapshot: 'button Submit' }
      forwarded.push({ method, params })
      throw new Error('Connection closed')
    }
  }))
  browser.target = { page: 'page-phone', worktree: 'cwd:/fixture', sessionId: 'session-phone', profileId: 'profile-phone', url: '', width: 0, height: 0, observedAt: 0 }
  await browser.observe()
  await expect(browser.act('browser.mouseClick', { x: 50, y: 100 })).rejects.toThrow('Connection closed')
  expect(forwarded).toEqual([{ method: 'browser.mouseClick', params: { x: 50, y: 100, page: 'page-phone', worktree: 'cwd:/fixture', expectUrl: 'https://fixture.test/' } }])
  await expect(browser.act('browser.type', { input: 'again' })).rejects.toThrow('Refresh before acting')
  await browser.observe()
  await expect(browser.act('browser.click', { element: '@e2', page: 'other' })).rejects.toThrow('Invalid mobile browser action')
  await expect(browser.act('browser.mouseClick', { x: 400, y: 100 })).rejects.toThrow('outside observed geometry')
  browser.close()
})
