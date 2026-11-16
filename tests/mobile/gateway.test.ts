import { afterEach, expect, test } from 'vitest'
import http from 'node:http'
import { startMobileGateway } from '../../src/mobile/gateway.js'
import type { JavisMethod } from '../../src/runtime/public.js'

type Gateway = Awaited<ReturnType<typeof startMobileGateway>>
const gateways: Gateway[] = []
afterEach(async () => { await Promise.all(gateways.splice(0).map(gateway => gateway.close())) })

const snapshot = {
  id: 'snapshot-1',
  app: { name: 'Fixture', bundleId: 'example.fixture', pid: 7 },
  window: { id: 42, index: 0, title: 'Fixture', width: 400, height: 200 },
  coordinateSpace: 'window', treeText: '0 window\n1 button', elementCount: 2, focusedElementId: null
}
const screenshot = { format: 'png', width: 800, height: 400, scale: 2, data: 'iVBORw0KGgo=', path: '/private/screenshot.png' }

async function gateway(call: (method: JavisMethod, params: Record<string, unknown>) => Promise<unknown>) {
  const result = await startMobileGateway({ bind: '127.0.0.1', port: 0, call })
  gateways.push(result)
  return result
}

function json(url: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(new URL(path, url), {
    method: 'POST',
    headers: { origin: new URL(url).origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

async function pair(gateway: Gateway) {
  const tokenResponse = await fetch(new URL('/api/pair-token', gateway.url))
  expect(tokenResponse.headers.get('set-cookie')).not.toContain('Secure')
  const anonymousCookie = tokenResponse.headers.get('set-cookie')?.split(';')[0] ?? ''
  const { csrfToken: pairToken } = await tokenResponse.json() as { csrfToken: string }
  const pairResponse = await json(gateway.url, '/api/pair', { code: gateway.pairingCode }, {
    cookie: anonymousCookie, 'x-javis-csrf': pairToken
  })
  expect(pairResponse.status).toBe(200)
  const setCookie = pairResponse.headers.get('set-cookie') ?? ''
  expect(setCookie).toContain('HttpOnly')
  expect(setCookie).not.toContain('Secure')
  expect(setCookie).toContain('SameSite=Strict')
  const cookie = setCookie.split(';')[0]
  const { csrfToken } = await pairResponse.json() as { csrfToken: string }
  return { cookie, csrfToken, headers: { cookie, 'x-javis-csrf': csrfToken } }
}

test('requires one-time pairing before app discovery and uses a private device cookie', async () => {
  const calls: JavisMethod[] = []
  const server = await gateway(async method => { calls.push(method); return { apps: [] } })
  const denied = await fetch(new URL('/api/apps', server.url))
  expect(denied.status).toBe(401)
  expect(calls).toEqual([])
  const page = await fetch(server.url)
  expect(page.status).toBe(200)
  expect(page.headers.get('cache-control')).toBe('no-store')
  expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
  const device = await pair(server)
  expect(device.cookie).toMatch(/^javis_mobile=/)
  const session = await fetch(new URL('/api/session', server.url), { headers: { cookie: device.cookie } })
  expect(session.status).toBe(200)
  const apps = await fetch(new URL('/api/apps', server.url), { headers: { cookie: device.cookie } })
  expect(apps.status).toBe(200)
  expect(calls).toEqual(['listApps'])
  const replay = await json(server.url, '/api/pair', { code: server.pairingCode }, device.headers)
  expect(replay.status).toBe(403)
})

test('rejects wrong host, cross-origin pairing, malformed and oversized bodies', async () => {
  const server = await gateway(async () => ({ apps: [] }))
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const request = http.request(server.url, { headers: { host: 'attacker.example' } }, response => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.on('error', reject)
    request.end()
  })
  expect(wrongHost).toBe(421)
  const tokenResponse = await fetch(new URL('/api/pair-token', server.url))
  const anonymousCookie = tokenResponse.headers.get('set-cookie')?.split(';')[0] ?? ''
  const { csrfToken } = await tokenResponse.json() as { csrfToken: string }
  const foreign = await json(server.url, '/api/pair', { code: server.pairingCode }, {
    cookie: anonymousCookie, 'x-javis-csrf': csrfToken, origin: 'https://attacker.example'
  })
  expect(foreign.status).toBe(403)
  const malformed = await fetch(new URL('/api/pair', server.url), {
    method: 'POST', headers: { origin: new URL(server.url).origin, cookie: anonymousCookie, 'x-javis-csrf': csrfToken, 'content-type': 'application/json' }, body: '{'
  })
  expect(malformed.status).toBe(400)
  const oversized = await json(server.url, '/api/pair', { code: server.pairingCode, padding: 'x'.repeat(40_000) }, {
    cookie: anonymousCookie, 'x-javis-csrf': csrfToken
  })
  expect(oversized.status).toBe(413)
})

test('requires same-origin CSRF and a private observation before each device acts', async () => {
  const forwarded: { method: JavisMethod; params: Record<string, unknown> }[] = []
  const server = await gateway(async (method, params) => {
    forwarded.push({ method, params })
    return { snapshot, screenshot, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
  })
  const first = await pair(server)
  const secondToken = await fetch(new URL('/api/pair-token', server.url))
  const secondCookie = secondToken.headers.get('set-cookie')?.split(';')[0] ?? ''
  const secondCsrf = (await secondToken.json() as { csrfToken: string }).csrfToken
  const secondPair = await json(server.url, '/api/pair', { code: server.pairingCode }, { cookie: secondCookie, 'x-javis-csrf': secondCsrf })
  expect(secondPair.status).toBe(403)
  const noObservation = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'first' }, first.headers)
  expect(noObservation.status).toBe(409)
  const observed = await json(server.url, '/api/observe', { app: 'example.fixture', windowId: 42 }, first.headers)
  expect(observed.status).toBe(200)
  const observedValue = await observed.json()
  expect(observedValue).not.toHaveProperty('sessionId')
  expect(observedValue.screenshot).not.toHaveProperty('path')
  const noCsrf = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'second' }, { cookie: first.cookie })
  expect(noCsrf.status).toBe(403)
  const badOrigin = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'third' }, { ...first.headers, origin: 'https://attacker.example' })
  expect(badOrigin.status).toBe(403)
  const action = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'fourth' }, first.headers)
  expect(action.status).toBe(200)
  expect(forwarded.map(call => call.method)).toEqual(['getAppState', 'click'])
  expect(forwarded[1].params).toMatchObject({ app: 'example.fixture', windowId: 42, elementIndex: 1, sessionId: forwarded[0].params.sessionId })
})

test('maps a screenshot tap to window points with the observed image scale', async () => {
  const forwarded: { method: JavisMethod; params: Record<string, unknown> }[] = []
  const server = await gateway(async (method, params) => {
    forwarded.push({ method, params })
    return { snapshot, screenshot, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
  })
  const device = await pair(server)
  await json(server.url, '/api/observe', { app: 'example.fixture', windowId: 42 }, device.headers)
  const action = await json(server.url, '/api/action', {
    method: 'click', params: { tap: { clientX: 100, clientY: 50, rectWidth: 400, rectHeight: 200 } }, requestId: 'tap-1'
  }, device.headers)
  expect(action.status).toBe(200)
  expect(forwarded[1].params).toMatchObject({ x: 100, y: 50 })
})

test('rejects tap coordinates when the observation did not contain image bytes', async () => {
  let actions = 0
  const server = await gateway(async (method, params) => {
    if (method === 'getAppState') return { snapshot, screenshot: { format: 'png', width: 800, height: 400, scale: 2, path: '/private/screenshot.png' }, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
    actions++
    return { snapshot, screenshot: null }
  })
  const device = await pair(server)
  await json(server.url, '/api/observe', { app: 'example.fixture' }, device.headers)
  const tap = await json(server.url, '/api/action', {
    method: 'click', params: { tap: { clientX: 100, clientY: 50, rectWidth: 400, rectHeight: 200 } }, requestId: 'hidden-image'
  }, device.headers)
  expect(tap.status).toBe(400)
  expect(actions).toBe(0)
})

test('binds an unselected window to the window returned by observation', async () => {
  const forwarded: { method: JavisMethod; params: Record<string, unknown> }[] = []
  const server = await gateway(async (method, params) => {
    forwarded.push({ method, params })
    return { snapshot, screenshot, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
  })
  const device = await pair(server)
  await json(server.url, '/api/observe', { app: 'example.fixture' }, device.headers)
  const action = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'window-1' }, device.headers)
  expect(action.status).toBe(200)
  expect(forwarded[1].params).toMatchObject({ app: 'example.fixture', windowId: 42 })
})

test('blocks actions after delivered observation failure and never replays an uncertain call', async () => {
  let actions = 0
  const server = await gateway(async (method, params) => {
    if (method === 'getAppState') return { snapshot, screenshot, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
    actions++
    return { action: { path: 'synthetic', delivery: 'background', verification: { state: 'unverified', reason: 'window_changed' } }, observationError: { code: 'window_not_found', message: 'Window closed' }, snapshot: null, screenshot: null }
  })
  const device = await pair(server)
  await json(server.url, '/api/observe', { app: 'example.fixture' }, device.headers)
  const delivered = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'delivered-1' }, device.headers)
  expect(delivered.status).toBe(200)
  expect(await delivered.json()).toMatchObject({ observationError: { code: 'window_not_found' }, snapshot: null })
  const blocked = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'delivered-2' }, device.headers)
  expect(blocked.status).toBe(409)
  expect(actions).toBe(1)
})

test('does not treat a malformed action result as a fresh observation', async () => {
  let actions = 0
  const server = await gateway(async (method, params) => {
    if (method === 'getAppState') return { snapshot, screenshot, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
    actions++
    return { snapshot: null, screenshot: null }
  })
  const device = await pair(server)
  await json(server.url, '/api/observe', { app: 'example.fixture' }, device.headers)
  const malformed = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'malformed-1' }, device.headers)
  expect(malformed.status).toBe(502)
  const blocked = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'malformed-2' }, device.headers)
  expect(blocked.status).toBe(409)
  expect(actions).toBe(1)
})

test('does not replay an action after a provider disconnect or a repeated request ID', async () => {
  let actions = 0
  const server = await gateway(async (method, params) => {
    if (method === 'getAppState') return { snapshot, screenshot, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
    actions++
    if (actions === 1) throw new Error('Connection closed; action delivery may be uncertain')
    return { snapshot, screenshot, screenshotStatus: { state: 'captured' } }
  })
  const device = await pair(server)
  await json(server.url, '/api/observe', { app: 'example.fixture' }, device.headers)
  const first = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'uncertain-1' }, device.headers)
  expect(first.status).toBe(502)
  const retry = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'uncertain-1' }, device.headers)
  expect(retry.status).toBe(409)
  expect(actions).toBe(1)
  await json(server.url, '/api/observe', { app: 'example.fixture' }, device.headers)
  const sameId = await json(server.url, '/api/action', { method: 'click', params: { elementIndex: 1 }, requestId: 'uncertain-1' }, device.headers)
  expect(sameId.status).toBe(409)
  expect(actions).toBe(1)
})

test('limits incorrect pairing attempts from one address', async () => {
  const server = await gateway(async () => ({ apps: [] }))
  const tokenResponse = await fetch(new URL('/api/pair-token', server.url))
  const anonymousCookie = tokenResponse.headers.get('set-cookie')?.split(';')[0] ?? ''
  const { csrfToken } = await tokenResponse.json() as { csrfToken: string }
  const headers = { cookie: anonymousCookie, 'x-javis-csrf': csrfToken }
  for (let attempt = 0; attempt < 5; attempt++) {
    const wrong = await json(server.url, '/api/pair', { code: 'wrong' }, headers)
    expect(wrong.status).toBe(403)
  }
  const blocked = await json(server.url, '/api/pair', { code: server.pairingCode }, headers)
  expect(blocked.status).toBe(403)
})

test('rejects action method and target injection before forwarding', async () => {
  const methods: JavisMethod[] = []
  const server = await gateway(async (method, params) => {
    methods.push(method)
    return { snapshot, screenshot, screenshotStatus: { state: 'captured' }, sessionId: params.sessionId }
  })
  const device = await pair(server)
  await json(server.url, '/api/observe', { app: 'example.fixture' }, device.headers)
  const unsupported = await json(server.url, '/api/action', { method: 'getAppState', params: {}, requestId: 'invalid-1' }, device.headers)
  expect(unsupported.status).toBe(400)
  const override = await json(server.url, '/api/action', { method: 'click', params: { app: 'other', elementIndex: 1 }, requestId: 'invalid-2' }, device.headers)
  expect(override.status).toBe(400)
  expect(methods).toEqual(['getAppState'])
})

test('requires TLS before binding to a LAN address', async () => {
  await expect(startMobileGateway({ bind: '192.0.2.1', port: 0, call: async () => ({}) })).rejects.toThrow(/certificate|TLS/i)
})
