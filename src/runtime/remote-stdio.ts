import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { JavisError } from './error.js'
import { callJavis, connectJavisBrowserStream } from './public.js'
import type { JavisMethod } from './session.js'
import { publicBrowserMethods, type BrowserMethod } from '../browser/contract/index.js'
import { isBrowserDaemonMethod, type JavisDaemonMethod } from './daemon-dispatch.js'
import { runtimeErrorDetails } from './error.js'

export type RemoteMethod = JavisMethod | 'permissionsStatus' | BrowserMethod | 'browser.open' | 'browser.status'
const MAX_FRAME_BYTES = 32 * 1024 * 1024
const REMOTE_DEADLINE_MS = 60_000
const RPC_METHODS: ReadonlySet<string> = new Set<RemoteMethod>([
  'capabilities', 'listApps', 'listWindows', 'getAppState', 'click',
  'performSecondaryAction', 'scroll', 'drag', 'typeText', 'pressKey',
  'hotkey', 'pasteText', 'setValue', 'permissionsStatus', ...publicBrowserMethods, 'browser.open', 'browser.status'
])

export type RemoteStdioOptions = {
  sshExecutable?: string
  sshPrefixArgs?: string[]
  timeoutMs?: number
  maxResponseBytes?: number
}

export async function callRemoteJavis(
  method: RemoteMethod,
  params: Record<string, unknown>,
  host: string,
  options: RemoteStdioOptions = {}
): Promise<unknown> {
  if (typeof host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(host)) {
    throw new JavisError('invalid_argument', 'host must be an OpenSSH alias without options or whitespace')
  }
  const deadline = options.timeoutMs ?? (isBrowserDaemonMethod(method) ? Math.max(90_000, typeof params.timeout === 'number' ? params.timeout + 30_000 : 0) : REMOTE_DEADLINE_MS)
  const maxBytes = options.maxResponseBytes ?? MAX_FRAME_BYTES
  if (!Number.isSafeInteger(deadline) || deadline <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new JavisError('invalid_argument', 'Remote transport limits must be positive integers')
  }
  let request: string
  try {
    request = JSON.stringify({ id: 1, method, params }) + '\n'
  } catch {
    throw new JavisError('invalid_argument', 'Remote Javis request cannot be serialized')
  }
  if (Buffer.byteLength(request) > MAX_FRAME_BYTES) {
    throw new JavisError('invalid_argument', 'Remote Javis request exceeds the size limit')
  }
  const args = [
    ...(options.sshPrefixArgs ?? []), '-T', '-o', 'BatchMode=yes',
    host, 'javis', 'rpc', '--stdio'
  ]
  const child = spawn(options.sshExecutable ?? 'ssh', args, {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (error?: JavisError, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill()
        reject(error)
      } else {
        resolve(value)
      }
    }
    const uncertain = (detail: string) => new JavisError('transport_error', `${detail}; action delivery may be uncertain`)
    const timer = setTimeout(() => {
      finish(new JavisError('action_timeout', 'Remote Javis request timed out; action delivery may be uncertain'))
    }, deadline)
    child.stderr?.resume()
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        finish(uncertain('Remote Javis response exceeds the size limit'))
        return
      }
      chunks.push(chunk)
    })
    child.stdin?.on('error', () => finish(uncertain('Could not send the remote Javis request')))
    child.on('error', error => finish(uncertain(`Could not start SSH: ${error.message}`)))
    child.on('close', (code, signal) => {
      if (settled) return
      if (code !== 0 || signal) {
        finish(uncertain(`SSH closed before a valid reply (status ${code ?? signal})`))
        return
      }
      try {
        finish(undefined, parseRemoteReply(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        finish(error instanceof JavisError ? error : uncertain('Remote Javis sent an invalid reply'))
      }
    })
    child.stdin?.end(request)
  })
}

function parseRemoteReply(frame: string): unknown {
  if (!frame.endsWith('\n') || frame.indexOf('\n') !== frame.length - 1) {
    throw new JavisError('transport_error', 'Remote Javis sent an invalid reply; action delivery may be uncertain')
  }
  let reply: unknown
  try {
    reply = JSON.parse(frame.slice(0, -1))
  } catch {
    throw new JavisError('transport_error', 'Remote Javis sent invalid JSON; action delivery may be uncertain')
  }
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
    throw new JavisError('transport_error', 'Remote Javis sent an invalid reply; action delivery may be uncertain')
  }
  const response = reply as Record<string, unknown>
  if (response.id !== 1) {
    throw new JavisError('transport_error', 'Remote Javis reply ID did not match; action delivery may be uncertain')
  }
  if (response.ok === true && Object.hasOwn(response, 'result')) return response.result
  if (response.ok === false && response.error && typeof response.error === 'object') {
    const error = response.error as Record<string, unknown>
    if (typeof error.code === 'string' && typeof error.message === 'string') {
      throw new JavisError(error.code, error.message, error.data)
    }
  }
  throw new JavisError('transport_error', 'Remote Javis sent an invalid reply; action delivery may be uncertain')
}

export async function runJavisStdioRpc(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  callLocal: (method: JavisDaemonMethod, params: Record<string, unknown>) => Promise<unknown> = callJavis,
  permissionStatus: () => Promise<unknown> = () => callJavis('permissionsStatus', {})
): Promise<void> {
  let id = 1
  let deliveredToDaemon = false
  let reply: Record<string, unknown>
  try {
    const frame = await readOneRequest(input)
    let parsed: unknown
    try {
      parsed = JSON.parse(frame)
    } catch {
      throw new JavisError('invalid_argument', 'Invalid RPC request JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new JavisError('invalid_argument', 'Invalid RPC request')
    }
    const request = parsed as Record<string, unknown>
    if (!Number.isSafeInteger(request.id)) throw new JavisError('invalid_argument', 'Invalid RPC request ID')
    id = request.id as number
    if (typeof request.method !== 'string' || !RPC_METHODS.has(request.method)) {
      throw new JavisError('invalid_argument', 'Unknown RPC method')
    }
    const params = request.params === undefined ? {} : request.params
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new JavisError('invalid_argument', 'RPC params must be an object')
    }
    deliveredToDaemon = true
    const result = request.method === 'permissionsStatus'
      ? await permissionStatus()
      : await callLocal(request.method as JavisDaemonMethod, params as Record<string, unknown>)
    reply = { id, ok: true, result }
  } catch (error) {
    const typedCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
    reply = {
      id,
      ok: false,
      error: {
        code: error instanceof JavisError ? error.code : deliveredToDaemon ? typedCode ?? 'internal_error' : 'invalid_argument',
        message: error instanceof JavisError || deliveredToDaemon && error instanceof Error ? error.message : 'Invalid RPC request',
        ...(deliveredToDaemon && runtimeErrorDetails(error).data !== undefined ? { data: runtimeErrorDetails(error).data } : {})
      }
    }
  }
  await new Promise<void>((resolve, reject) => {
    output.write(JSON.stringify(reply) + '\n', error => error ? reject(error) : resolve())
  })
}

async function readOneRequest(input: Readable): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of input) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += data.length
    if (bytes > MAX_FRAME_BYTES) throw new JavisError('invalid_argument', 'RPC request exceeds the size limit')
    chunks.push(data)
  }
  const frame = Buffer.concat(chunks).toString('utf8')
  if (!frame.endsWith('\n') || frame.indexOf('\n') !== frame.length - 1) {
    throw new JavisError('invalid_argument', 'Expected exactly one JSONL request')
  }
  return frame.slice(0, -1)
}


export async function runBrowserRemoteStdioBridge(input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const { BrowserFrameDecoder, writeBrowserFrame } = await import('../browser/remote/framed-channel.js')
  const { browserMethods } = await import('../browser/contract/index.js')
  const allowed = new Set<string>([...browserMethods, 'browser.status'])
  let connection: import('../browser/remote/framed-channel.js').BrowserStream | undefined
  const decoder = new BrowserFrameDecoder()
  const inFlight = new Set<Promise<void>>()
  const ids = new Set<number>()
  output.on('drain', () => connection?.setBacklogged?.(false))
  try {
    for await (const chunk of input) {
      for (const frame of decoder.push(Buffer.from(chunk))) {
        if (!Number.isSafeInteger(frame.id) || (frame.id as number) < 1 || ids.has(frame.id as number) || typeof frame.method !== 'string' || !frame.params || typeof frame.params !== 'object' || Array.isArray(frame.params)) throw new JavisError('invalid_argument', 'Invalid browser stream request')
        ids.add(frame.id as number)
        if (ids.size > 100_000 || inFlight.size >= 2048) throw new JavisError('transport_error', 'Browser channel request budget exhausted')
        if (!connection) {
          const identity = frame.params as Record<string, unknown>
          if (frame.method !== '__browserStreamIdentity' || typeof identity.pairedDeviceId !== 'string' || !identity.pairedDeviceId || identity.pairedDeviceId.length > 256 || !['runtime', 'mobile'].includes(String(identity.clientKind))) throw new JavisError('access_denied', 'SSH browser caller identity is required')
          connection = await connectJavisBrowserStream({
            identity: { pairedDeviceId: identity.pairedDeviceId, clientKind: identity.clientKind as 'runtime' | 'mobile', clientCapabilities: Array.isArray(identity.clientCapabilities) ? identity.clientCapabilities.filter((value): value is string => typeof value === 'string') : [] },
            forwardDelivery: true,
            onEvent: event => { try { const result = writeBrowserFrame(output, { type: 'event', ...event }, { dropWhenBacklogged: event.method === 'browser.stream.binary' }); if (result === 'backlogged') void connection?.call('__browserDelivery', { packetId: event.params.packetId, outcome: 'backlogged', backlogged: true }).catch(() => connection?.close()) } catch { connection?.close(); input.destroy() } },
            onClose: () => { input.destroy(); output.end() }
          })
          writeBrowserFrame(output, { id: frame.id, ok: true, result: { connected: true } })
          continue
        }
        if (!allowed.has(frame.method) && !['__browserHost', '__browserNetwork', '__browserAuthority', '__browserDelivery', '__browserFlow'].includes(frame.method)) throw new JavisError('access_denied', 'Browser stream method is not allowed')
        const operation = connection.call(frame.method, frame.params as Record<string, unknown>).then(
          result => { writeBrowserFrame(output, { id: frame.id, ok: true, result }) },
          error => { writeBrowserFrame(output, { id: frame.id, ok: false, error: runtimeErrorDetails(error) }) }
        )
        inFlight.add(operation)
        void operation.finally(() => inFlight.delete(operation)).catch(() => { connection?.close(); input.destroy() })
      }
    }
    decoder.finish()
  } finally { connection?.close(); await Promise.allSettled(inFlight) }
}

export async function connectRemoteJavisBrowserStream(host: string, options: import('../browser/remote/framed-channel.js').BrowserStreamOptions, transport: RemoteStdioOptions = {}): Promise<import('../browser/remote/framed-channel.js').BrowserStream> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/.test(host)) throw new JavisError('invalid_argument', 'host must be an OpenSSH alias')
  const { createBrowserStreamClient } = await import('../browser/remote/framed-channel.js')
  const child = spawn(transport.sshExecutable ?? 'ssh', [...(transport.sshPrefixArgs ?? []), '-T', '-o', 'BatchMode=yes', host, 'javis', 'rpc', '--stream-stdio'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  child.stderr.resume()
  const connection = createBrowserStreamClient(child.stdout, child.stdin, { ...options, onClose: error => { child.kill(); options.onClose?.(error) } })
  child.once('error', () => connection.close()); child.once('close', () => connection.close())
  try { await connection.call('__browserStreamIdentity', options.identity); return connection }
  catch (error) { connection.close(); throw error }
}
