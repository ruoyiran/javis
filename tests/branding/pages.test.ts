import { expect, test } from 'vitest'
import { startJavisSettings } from '../../src/settings/server.js'
import { startMobileGateway } from '../../src/mobile/gateway.js'

test('settings serves the selected logo and a self-contained favicon allowed by its CSP', async () => {
  const server = await startJavisSettings({
    permissions: { status: async () => ({}), open: async () => ({}), reset: async () => ({}) },
    installAgent: async () => {}, agentStatus: async () => []
  })
  try {
    const response = await fetch(server.url)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(/<header[^>]*>[\s\S]*<svg[^>]*aria-hidden="true"[\s\S]*<h1>Javis Settings<\/h1>/)
    const favicon = html.match(/<link rel="icon"[^>]*href="([^"]+)"/)?.[1]
    expect(favicon).toMatch(/^data:image\/svg\+xml,/)
    const svg = decodeURIComponent(favicon!.split(',').slice(1).join(','))
    expect(svg).toContain('viewBox="0 0 1024 1024"')
    expect(svg).toContain('fill="#6C326A"')
    expect(svg).toContain('fill="#FB5E75"')
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self' data:")
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  } finally { await server.close() }
})

test('the unpaired phone page serves the same logo without a desktop request', async () => {
  const server = await startMobileGateway({
    bind: '127.0.0.1', port: 0,
    call: async () => { throw new Error('A public branding page must not request desktop access') }
  })
  try {
    const response = await fetch(server.url)
    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toMatch(/<header[^>]*>[\s\S]*<svg[^>]*aria-hidden="true"[\s\S]*<h1>Javis Mobile<\/h1>/)
    const favicon = html.match(/<link rel="icon"[^>]*href="([^"]+)"/)?.[1]
    expect(favicon).toMatch(/^data:image\/svg\+xml,/)
    const svg = decodeURIComponent(favicon!.split(',').slice(1).join(','))
    expect(svg).toContain('fill="#6C326A"')
    expect(svg).toContain('fill="#FB5E75"')
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self' data:")
  } finally { await server.close() }
})
