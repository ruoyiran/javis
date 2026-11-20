import { describe, expect, it } from 'vitest'
import { deleteCookieByName } from '../../../src/browser/source/main/browser/cookies/browser-cookie-delete-by-name'

describe('cookie deletion filters', () => {
  it('keeps other domains and cookie names while deleting host and domain cookies', async () => {
    const commands: Record<string, unknown>[] = []
    const result = await deleteCookieByName(async (method, params) => {
      if (method === 'Network.getAllCookies') return { cookies: [
        { name: 'sid', domain: '.example.com', path: '/' },
        { name: 'sid', domain: 'example.com', path: '/account' },
        { name: 'sid', domain: 'other.test', path: '/' },
        { name: 'keep', domain: '.example.com', path: '/' }
      ] }
      commands.push({ method, ...params })
      return {}
    }, 'sid', { domain: '.Example.COM', pageUrl: 'https://ignored.test/' })
    expect(result).toEqual({ deleted: true })
    expect(commands).toEqual([
      { method: 'Network.deleteCookies', name: 'sid', domain: '.example.com', path: '/' },
      { method: 'Network.deleteCookies', name: 'sid', domain: 'example.com', path: '/account' }
    ])
  })
})
