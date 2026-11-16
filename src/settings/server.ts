import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { renderSettingsPage } from './page.js'

type PermissionId = 'accessibility' | 'screenshots'
type Agent = 'codex' | 'claude'

type SettingsOptions = {
  port?: number
  permissions: {
    status: () => Promise<unknown>
    open: (id: PermissionId) => Promise<unknown>
    reset: () => Promise<unknown>
  }
  installAgent: (agent: Agent) => Promise<unknown>
  agentStatus: () => Promise<unknown>
}

type SettingsServer = { url: string; token: string; close: () => Promise<void> }

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 4096) throw new Error('Request body exceeds 4096 bytes')
    chunks.push(Buffer.from(chunk))
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected JSON object')
  return parsed as Record<string, unknown>
}

export async function startJavisSettings(options: SettingsOptions): Promise<SettingsServer> {
  const token = randomBytes(32).toString('hex')
  const nonce = randomBytes(16).toString('base64')
  const prefix = `/settings/${token}/`
  let expectedHost = ''
  let expectedOrigin = ''
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader('cache-control', 'no-store')
      response.setHeader('referrer-policy', 'no-referrer')
      response.setHeader('x-content-type-options', 'nosniff')
      response.setHeader('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`)
      if (request.headers.host !== expectedHost || !request.url?.startsWith(prefix)) {
        json(response, 404, { error: 'Not found' })
        return
      }
      const route = request.url.slice(prefix.length)
      if (request.method === 'GET' && route === '') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(renderSettingsPage(nonce))
        return
      }
      if (request.method === 'GET' && route === 'api/status') {
        json(response, 200, await options.permissions.status())
        return
      }
      if (request.method === 'GET' && route === 'api/agents') {
        json(response, 200, await options.agentStatus())
        return
      }
      if (request.method !== 'POST' || !['api/open', 'api/reset', 'api/install'].includes(route)) {
        json(response, 404, { error: 'Not found' })
        return
      }
      if (request.headers.origin !== expectedOrigin || request.headers['x-javis-settings-token'] !== token || request.headers['content-type'] !== 'application/json') {
        json(response, 403, { error: 'Invalid settings request' })
        return
      }
      const body = await bodyOf(request)
      if (route === 'api/open') {
        if (body.id !== 'accessibility' && body.id !== 'screenshots') throw new Error('Invalid permission ID')
        json(response, 200, await options.permissions.open(body.id))
      } else if (route === 'api/reset') {
        json(response, 200, await options.permissions.reset())
      } else {
        if (body.agent !== 'codex' && body.agent !== 'claude') throw new Error('Invalid agent')
        await options.installAgent(body.agent)
        json(response, 200, { installed: body.agent })
      }
    })().catch(error => {
      if (!response.headersSent) json(response, 400, { error: error instanceof Error ? error.message : String(error) })
      else response.destroy()
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Invalid settings address')
  expectedHost = `127.0.0.1:${address.port}`
  expectedOrigin = `http://${expectedHost}`
  return {
    url: `${expectedOrigin}${prefix}`,
    token,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
}
