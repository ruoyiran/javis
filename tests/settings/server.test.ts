import { expect, test, vi } from 'vitest'
import { startJavisSettings } from '../../src/settings/server.js'

test('serves permission state and invokes an explicitly requested setup action', async () => {
  const open = vi.fn(async () => {})
  const status = vi.fn(async () => ({ platform: 'darwin' as const, permissions: [
    { id: 'accessibility' as const, status: 'granted' as const },
    { id: 'screenshots' as const, status: 'not-granted' as const }
  ] }))
  const settings = await startJavisSettings({ port: 0, permissions: { status, open, reset: async () => ({ platform: 'darwin', permissions: [] }) }, installAgent: async () => {}, agentStatus: async () => [{ agent: 'codex', mcp: true, skill: true }] })
  try {
    const page = await fetch(settings.url)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Screen Recording')
    const state = await fetch(new URL('api/status', settings.url))
    expect(await state.json()).toEqual({ platform: 'darwin', permissions: [
      { id: 'accessibility', status: 'granted' }, { id: 'screenshots', status: 'not-granted' }
    ] })
    const agents = await fetch(new URL('api/agents', settings.url))
    expect(await agents.json()).toEqual([{ agent: 'codex', mcp: true, skill: true }])
    const denied = await fetch(new URL('api/open', settings.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'screenshots' }) })
    expect(denied.status).toBe(403)
    expect(open).not.toHaveBeenCalled()
    const accepted = await fetch(new URL('api/open', settings.url), { method: 'POST', headers: {
      'content-type': 'application/json',
      'x-javis-settings-token': settings.token,
      origin: new URL(settings.url).origin
    }, body: JSON.stringify({ id: 'screenshots' }) })
    expect(accepted.status).toBe(200)
    expect(open).toHaveBeenCalledWith('screenshots')
  } finally { await settings.close() }
})
