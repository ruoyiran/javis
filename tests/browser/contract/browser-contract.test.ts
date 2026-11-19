import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validateBrowserParams } from '../../../src/browser/contract/index.js'
import { registerBrowserMcpTools } from '../../../src/browser/mcp/index.js'

describe('browser adapter contracts', () => {
  it('preserves empty values and rejects a nonabsolute URL guard', () => {
    expect(validateBrowserParams('browser.cookie.set', { name: 'session', value: '', page: 'page-9' })).toEqual({ name: 'session', value: '', page: 'page-9' })
    expect(() => validateBrowserParams('browser.fill', { element: '@e1', value: '', expectUrl: 'relative/path' })).toThrow('--expect-url must be an absolute URL')
    expect(() => validateBrowserParams('browser.profileCreate', { label: 'QA', scope: 'other' })).toThrow()
  })
  it('registers public tools and keeps image bytes out of the metadata', async () => {
    const tools = new Map<string, (params: Record<string, unknown>) => Promise<any>>()
    registerBrowserMcpTools((name, _config, handler) => { tools.set(name, handler) }, {
      call: async () => ({ browserPageId: 'page-9', format: 'jpeg', data: 'aW1hZ2U=', width: 20, height: 30 })
    })
    expect(tools.has('javis_browser_client_host_attach')).toBe(false)
    const result = await tools.get('javis_browser_screenshot')!({ page: 'page-9' })
    expect(result.content).toEqual([
      { type: 'text', text: '{"ok":true,"result":{"browserPageId":"page-9","format":"jpeg","width":20,"height":30}}' },
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/jpeg' }
    ])
  })
})


it('accepts a nested client page placement and rejects missing host identity', async () => {
  let inputSchema: z.ZodObject | undefined
  let handler: ((params: Record<string, unknown>) => Promise<unknown>) | undefined
  const requests: unknown[] = []
  registerBrowserMcpTools((name, config, run) => {
    if (name === 'javis_browser_tab_create') { inputSchema = z.object(config.inputSchema).strict(); handler = run }
  }, { call: async (method, params, target) => { requests.push({ method, params, target }); return { browserPageId: 'page-9' } } })
  const args = inputSchema!.parse({ url: 'https://example.com', placement: { kind: 'client', browserHostClientId: 'client-3' }, profileId: 'profile-2', navigation: 'clients', host: 'build-host', context: 'folder-session' })
  await handler!(args)
  expect(requests).toEqual([{ method: 'browser.tabCreate', params: { url: 'https://example.com', placement: { kind: 'client', browserHostClientId: 'client-3' }, profileId: 'profile-2', navigation: 'clients', worktree: 'folder-session' }, target: { host: 'build-host', context: 'folder-session' } }])
  expect(() => inputSchema!.parse({ placement: { kind: 'client', browserHostClientId: '' } })).toThrow()
})
