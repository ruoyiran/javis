import { mobileBrowserJavaScript } from './browser-page.js'
import { connectJavisBrowserStream } from '../runtime/public.js'
import { MobileBrowserSession } from './browser-session.js'
import type { BrowserStreamOptions, BrowserStream } from '../browser/remote/framed-channel.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import { isIP, type AddressInfo } from 'node:net'
import type { ComputerScreenshotData } from '../contract/computer-use-runtime-types.js'
import type { JavisMethod } from '../runtime/public.js'
import { actionRequestParams, isMobileActionMethod } from './action-request.js'
import type { DeviceSession, DeviceTarget } from './device-session.js'
import { MobilePairing } from './pairing.js'
import { mobileCss, mobileHtml, mobileJavaScript } from './page.js'

export type MobileGatewayOptions = {
  browserConnect?: (options: BrowserStreamOptions) => Promise<BrowserStream>
  bind: string
  port: number
  cert?: string
  key?: string
  call: (method: JavisMethod, params: Record<string, unknown>) => Promise<unknown>
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
const bodyLimit = 32_768
const observationLifetime = 120_000

export async function startMobileGateway(options: MobileGatewayOptions): Promise<{
  url: string
  pairingCode: string
  close: () => Promise<void>
}> {
  if (!isIP(options.bind)) throw new Error('Bind must be an IP address')
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Invalid port')
  const loopback = options.bind === '127.0.0.1' || options.bind === '::1'
  if (!loopback && (!options.cert || !options.key)) throw new Error('TLS certificate and key are required for a non-loopback bind')
  if (Boolean(options.cert) !== Boolean(options.key)) throw new Error('TLS certificate and key must be provided together')
  const pairing = new MobilePairing()
  const tls = Boolean(options.cert)
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response).catch(error => {
      if (response.headersSent || response.destroyed) { response.end(); return }
      const safe = publicGatewayError(error)
      sendJson(response, safe.status, { error: { code: safe.code, message: safe.message } })
    })
  }
  const server = tls
    ? https.createServer({ cert: await pem(options.cert as string), key: await pem(options.key as string) }, handler)
    : http.createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.bind, () => { server.off('error', reject); resolve() })
  })
  const port = (server.address() as AddressInfo).port
  const host = options.bind.includes(':') ? `[${options.bind}]` : options.bind
  const url = `${tls ? 'https' : 'http'}://${host}:${port}/`
  const origin = new URL(url).origin
  const expectedHost = new URL(url).host
  let closed = false

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Security-Policy', csp)
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    if (request.headers.host?.toLowerCase() !== expectedHost.toLowerCase()) throw new HttpError(421, 'Unrecognized host')
    if (request.headers.origin && request.headers.origin !== origin) throw new HttpError(403, 'Origin denied')
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site request denied')
    const path = new URL(request.url ?? '/', url)
    const method = request.method
    if (method === 'GET' && path.pathname === '/') return sendText(response, mobileHtml, 'text/html; charset=utf-8')
    if (method === 'GET' && path.pathname === '/browser-mobile.js') return sendText(response, mobileBrowserJavaScript, 'text/javascript; charset=utf-8')
    if (method === 'GET' && path.pathname === '/mobile.js') return sendText(response, mobileJavaScript, 'text/javascript; charset=utf-8')
    if (method === 'GET' && path.pathname === '/mobile.css') return sendText(response, mobileCss, 'text/css; charset=utf-8')
    if (method === 'GET' && path.pathname === '/api/pair-token') {
      const token = pairing.issueToken()
      response.setHeader('Set-Cookie', cookieHeader('javis_mobile_pair', token.cookie, tls))
      return sendJson(response, 200, { csrfToken: token.csrfToken })
    }
    if (method === 'POST') requireOrigin(request, origin)
    if (method === 'POST' && path.pathname === '/api/pair') {
      const code = (await readJson(request)).code
      const paired = pairing.pair(code, cookie(request, 'javis_mobile_pair'), header(request, 'x-javis-csrf'), request.socket.remoteAddress ?? '')
      if (!paired) throw new HttpError(403, 'Pairing denied')
      response.setHeader('Set-Cookie', [cookieHeader('javis_mobile', paired.cookie, tls), cookieHeader('javis_mobile_pair', '', tls, 0)])
      return sendJson(response, 200, { csrfToken: paired.device.csrfToken })
    }
    if (!path.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found')
    const device = pairing.device(cookie(request, 'javis_mobile'))
    if (!device) throw new HttpError(401, 'Pairing required')
    if (method === 'GET' && path.pathname === '/api/session') return sendJson(response, 200, { paired: true, csrfToken: device.csrfToken })
    if (method === 'GET' && path.pathname === '/api/apps') return sendJson(response, 200, await options.call('listApps', {}))
    if (method === 'GET' && path.pathname === '/api/windows') {
      const app = path.searchParams.get('app')
      if (!app || app.length > 256) throw new HttpError(400, 'App is required')
      return sendJson(response, 200, await options.call('listWindows', { app }))
    }
    if (method === 'POST') requireCsrf(request, device)
    if (path.pathname.startsWith('/api/browser/')) {
      device.browser ??= new MobileBrowserSession(options.browserConnect ?? connectJavisBrowserStream)
      const browser = device.browser
      if (method === 'GET' && path.pathname === '/api/browser/events') {
        response.setHeader('Content-Type', 'text/event-stream')
        response.flushHeaders()
        const detachViewer = browser.attachViewer(event => {
          if (response.destroyed) return
          if (response.writableLength > 8 * 1024 * 1024) { browser.close(); response.destroy(); return }
          if (response.writableNeedDrain && event.method === 'browser.stream.binary') return { outcome: 'backlogged', backlogged: true }
          response.write(`data: ${JSON.stringify(event)}\n\n`)
          if (event.params.type === 'end') response.end()
          return { outcome: true, backlogged: response.writableNeedDrain }
        })
        response.on('drain', () => browser.setBacklogged(false))
        response.once('close', detachViewer)
        return
      }
      if (method === 'GET' && path.pathname === '/api/browser/pages') return sendJson(response, 200, await browser.call('browser.tabList', {}))
      if (method !== 'POST') throw new HttpError(404, 'Not found')
      const body = await readJson(request)
      return device.run(async () => {
        if (path.pathname === '/api/browser/select') {
          if (typeof body.page !== 'string' || !body.page || Object.keys(body).some(key => key !== 'page')) throw new HttpError(400, 'Invalid page selection')
          const result = await browser.call('browser.tabList', {}) as { tabs?: Record<string, unknown>[] }
          const page = result.tabs?.find(tab => tab.pageId === body.page || tab.browserPageId === body.page)
          if (!page) throw new HttpError(404, 'Browser page is unavailable')
          await browser.select({ page: body.page, worktree: typeof page.worktreeId === 'string' ? page.worktreeId : 'default', profileId: typeof page.profileId === 'string' ? page.profileId : undefined, sessionId: randomUUID(), url: '', width: 0, height: 0, observedAt: 0 })
          browser.requiresRefresh = true
          return sendJson(response, 200, await browser.observe())
        }
        if (path.pathname === '/api/browser/observe') return sendJson(response, 200, await browser.observe())
        if (path.pathname === '/api/browser/stream') {
          for (const key of ['width', 'height', 'deviceScaleFactor']) if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || (body[key] as number) <= 0 || (body[key] as number) > 3840) throw new HttpError(400, 'Invalid browser stream geometry')
          const ready = await browser.startStream(body)
          const observation = await browser.observe()
          return sendJson(response, 200, { ready, ...observation })
        }
        if (path.pathname === '/api/browser/ack') return sendJson(response, 200, await browser.ack(body.seq as number))
        if (path.pathname === '/api/browser/action') {
          if (typeof body.method !== 'string' || !record(body.params) || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.requestId)) throw new HttpError(400, 'Invalid browser action')
          if (!device.acceptRequestId(body.requestId)) throw new HttpError(409, 'Action request already used')
          return sendJson(response, 200, await browser.act(body.method, body.params, record(body.frame) ? body.frame as { subscriptionId: string; seq: number } : undefined))
        }
        throw new HttpError(404, 'Not found')
      })
    }
    if (method === 'POST' && path.pathname === '/api/observe') {
      const body = await readJson(request)
      const target = observationTarget(body)
      return device.run(async () => {
        device.requiresRefresh = true
        const sessionId = randomUUID()
        const result = responseValue(await options.call('getAppState', { ...target, sessionId }))
        if (!record(result.snapshot)) throw new HttpError(502, 'Observation did not return a snapshot')
        const window = record(result.snapshot.window) ? result.snapshot.window : null
        const windowId = window?.id
        const windowIndex = window?.index
        const boundWindow = typeof windowId === 'number' && Number.isInteger(windowId) && windowId >= 0
          ? { windowId }
          : typeof windowIndex === 'number' && Number.isInteger(windowIndex) && windowIndex >= 0
            ? { windowIndex }
            : target.windowId !== undefined ? { windowId: target.windowId } : target.windowIndex !== undefined ? { windowIndex: target.windowIndex } : {}
        device.target = { app: target.app, ...boundWindow, sessionId, observedAt: Date.now(), screenshot: screenshotGeometry(result.screenshot) }
        device.requiresRefresh = false
        sendJson(response, 200, result)
      })
    }
    if (method === 'POST' && path.pathname === '/api/action') {
      const body = await readJson(request)
      if (!isMobileActionMethod(body.method) || !record(body.params) || typeof body.requestId !== 'string' ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(body.requestId)) throw new HttpError(400, 'Invalid action request')
      return device.run(async () => {
        const target = device.target
        if (!target || device.requiresRefresh || Date.now() - target.observedAt > observationLifetime) throw new HttpError(409, 'Refresh before acting')
        if (!device.acceptRequestId(body.requestId as string)) throw new HttpError(409, 'Action request already used')
        let params: Record<string, unknown>
        try { params = await actionRequestParams(body.method as Parameters<typeof actionRequestParams>[0], body.params as Record<string, unknown>, target) }
        catch { throw new HttpError(400, 'Invalid action parameters') }
        device.requiresRefresh = true
        const result = responseValue(await options.call(body.method as JavisMethod, params))
        if (!record(result.snapshot) && !record(result.observationError)) throw new HttpError(502, 'Action did not return an observation')
        if (record(result.snapshot) && !result.observationError) {
          device.target = { ...target, observedAt: Date.now(), screenshot: screenshotGeometry(result.screenshot) }
          device.requiresRefresh = false
        }
        sendJson(response, 200, result)
      })
    }
    throw new HttpError(404, 'Not found')
  }

  return {
    url, pairingCode: pairing.pairingCode,
    close: async () => {
      if (closed) return
      closed = true
      pairing.close()
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
        server.closeAllConnections()
      })
    }
  }
}

function publicGatewayError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof HttpError) return { status: error.status, code: 'invalid_request', message: error.message }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'window_not_found') return { status: 404, code, message: 'No ordinary visible window is available; open a window and refresh.' }
  if (code === 'app_not_found') return { status: 404, code, message: 'The selected desktop app is unavailable; refresh the app list.' }
  if (code === 'permission_denied') return { status: 403, code, message: 'Javis lacks desktop access on this host; check its permissions.' }
  if (code === 'stale_snapshot' || code === 'element_not_found') return { status: 409, code, message: 'The observation is stale; refresh before acting.' }
  if (code === 'action_timeout') return { status: 504, code, message: 'Action delivery may be uncertain; refresh before acting again.' }
  return { status: 502, code: 'transport_error', message: 'Javis request failed; refresh before acting' }
}

async function pem(value: string): Promise<string> {
  return value.includes('-----BEGIN') ? value : readFile(value, 'utf8')
}

function cookieHeader(name: string, value: string, secure: boolean, maxAge?: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}`
}

function cookie(request: IncomingMessage, name: string): string | undefined {
  const values = request.headers.cookie?.split(';').map(part => part.trim().split('=', 2)).filter(([key]) => key === name) ?? []
  return values.length === 1 ? values[0][1] : undefined
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return typeof value === 'string' ? value : undefined
}

function requireOrigin(request: IncomingMessage, origin: string): void {
  if (request.headers.origin !== origin) throw new HttpError(403, 'Origin required')
}

function requireCsrf(request: IncomingMessage, device: DeviceSession): void {
  if (header(request, 'x-javis-csrf') !== device.csrfToken) throw new HttpError(403, 'CSRF token required')
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'JSON required')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > bodyLimit) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk)
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!record(value)) throw new Error('Object required')
    return value
  } catch { throw new HttpError(400, 'Malformed JSON') }
}

function observationTarget(body: Record<string, unknown>): Pick<DeviceTarget, 'app' | 'windowId' | 'windowIndex'> {
  if (Object.keys(body).some(key => !['app', 'windowId', 'windowIndex'].includes(key)) ||
    typeof body.app !== 'string' || !body.app || body.app.length > 256) throw new HttpError(400, 'Invalid app selection')
  const windowId = body.windowId
  const windowIndex = body.windowIndex
  if ((windowId !== undefined && (!Number.isInteger(windowId) || (windowId as number) < 0)) ||
    (windowIndex !== undefined && (!Number.isInteger(windowIndex) || (windowIndex as number) < 0)) ||
    (windowId !== undefined && windowIndex !== undefined)) throw new HttpError(400, 'Invalid window selection')
  return {
    app: body.app,
    ...(windowId !== undefined ? { windowId: windowId as number } : {}),
    ...(windowIndex !== undefined ? { windowIndex: windowIndex as number } : {})
  }
}

function responseValue(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new HttpError(502, 'Invalid Javis response')
  const { sessionId: _sessionId, screenshot, ...rest } = value
  if (!record(screenshot)) return { ...rest, screenshot: null }
  const safeScreenshot: Record<string, unknown> = {}
  for (const key of ['format', 'width', 'height', 'scale', 'data']) if (screenshot[key] !== undefined) safeScreenshot[key] = screenshot[key]
  return { ...rest, screenshot: safeScreenshot }
}

function screenshotGeometry(value: unknown): DeviceTarget['screenshot'] {
  if (!record(value) || value.format !== 'png' || typeof value.data !== 'string' || !value.data ||
    typeof value.width !== 'number' || typeof value.height !== 'number' ||
    typeof value.scale !== 'number' || !Number.isFinite(value.width) || !Number.isFinite(value.height) || !Number.isFinite(value.scale) ||
    value.width <= 0 || value.height <= 0 || value.scale <= 0) return null
  return { width: value.width, height: value.height, scale: value.scale } satisfies Pick<ComputerScreenshotData, 'width' | 'height' | 'scale'>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sendText(response: ServerResponse, body: string, contentType: string): void {
  response.statusCode = 200
  response.setHeader('Content-Type', contentType)
  response.end(body)
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}
