import { BrowserHostSubscriptions } from '../browser/remote/host-subscriptions.js'
import { dispatchBrowserHostRequest, closeBrowserHostConnections } from '../browser/remote/host-dispatch.js'
import net from 'node:net'
import { createBrowserStreamClient, type BrowserStream, type BrowserStreamOptions } from '../browser/remote/framed-channel.js'
import { serveBrowserDaemonStream } from '../browser/remote/daemon-stream.js'
import { spawn, execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { acquireDaemonLock, assertDaemonRecoveryAvailable, parseDaemonPid } from './daemon-lock.js'
import { daemonEndpoint, type DaemonEndpoint } from './daemon-endpoint.js'
import { createDaemonDispatch, isBrowserDaemonMethod, browserDaemonParams, type JavisDaemonMethod } from './daemon-dispatch.js'
import { parseDaemonRequest } from './daemon-request.js'
import { JavisError } from './error.js'
import { createProviderForPlatform } from './provider-selection.js'
import { validateComputerProviderActionParams } from './computer-provider-action-validation.js'
import { validateComputerRequestParams } from './computer-request-validation.js'
import { SessionRuntime, type JavisMethod } from './session.js'
import { JsonLineDecoder, DeliveryQueue } from './transport.js'
import { runtimeErrorDetails } from './error.js'
import { callBrowser, stopBrowserProcess, subscribeBrowserEvents } from '../browser/runtime/browser-process.js'
import { readJavisPermissionStatus, openJavisPermissions, resetJavisPermissions, cancelJavisPermissionOperations } from '../permissions.js'

export { JavisError }
export type { JavisMethod }
export type { JavisDaemonMethod }

const actions = new Set<string>([
  'click', 'performSecondaryAction', 'scroll', 'drag', 'typeText',
  'pressKey', 'hotkey', 'pasteText', 'setValue'
])
const permissionMethods = new Set<string>(['permissionsStatus', 'permissionsOpen', 'permissionsReset'])

function endpoint(): DaemonEndpoint {
  return daemonEndpoint(process.platform, homedir(), process.env)
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new JavisError('access_denied', 'Javis state directory is unsafe')
  if (process.getuid && info.uid !== process.getuid()) throw new JavisError('access_denied', 'Javis state directory must be owned by current user')
  if (process.platform !== 'win32') await chmod(directory, 0o700)
}

function connect(address: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address)
    socket.once('connect', () => { socket.off('error', reject); resolve(socket) })
    socket.once('error', reject)
  })
}

async function waitConnect(address: string, milliseconds: number): Promise<net.Socket> {
  const deadline = Date.now() + milliseconds
  while (true) {
    try { return await connect(address) }
    catch (error) {
      if (Date.now() >= deadline) throw new JavisError('startup_timeout', `Javis daemon did not start: ${String(error)}`)
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }
}

function request(socket: net.Socket, method: string, params: Record<string, unknown>, token?: string, timeoutMs = 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const decoder = new JsonLineDecoder()
    let settled = false
    const cleanup = () => { clearTimeout(timer); socket.off('data', data); socket.off('close', closed); socket.off('error', failed) }
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result)
    }
    const failed = (error: Error) => finish(error instanceof JavisError ? error : new JavisError('transport_error', error.message))
    const closed = () => failed(new Error('Connection closed; action delivery may be uncertain'))
    const data = (chunk: Buffer) => {
      let lines: string[]
      try { lines = decoder.push(chunk) } catch (error) { failed(error as Error); return }
      if (!lines.length) return
      try {
        const reply = JSON.parse(lines[0]) as { id?: number; ok?: boolean; result?: unknown; error?: { code?: string; message?: string; data?: unknown } }
        if (reply.id !== 1) throw new JavisError('transport_error', 'Mismatched daemon response ID')
        if (reply.ok === true) finish(undefined, reply.result)
        else finish(new JavisError(reply.error?.code ?? 'transport_error', reply.error?.message ?? 'Javis request failed', reply.error?.data))
      } catch (error) { failed(error as Error) }
    }
    const timer = setTimeout(() => {
      finish(new JavisError('action_timeout', 'Request timed out; action delivery may be uncertain'))
      socket.destroy()
    }, isBrowserDaemonMethod(method) ? Math.max(90_000, typeof params.timeout === 'number' ? params.timeout + 30_000 : 0) : timeoutMs)
    socket.on('data', data); socket.once('close', closed); socket.once('error', failed)
    socket.write(JSON.stringify({ id: 1, method, params, token }) + '\n', error => { if (error) failed(error) })
  })
}

async function readDaemonToken(target: DaemonEndpoint): Promise<string | undefined> {
  try { return (await readFile(target.tokenPath, 'utf8')).trim() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !target.namedPipe) return undefined
    throw error
  }
}

export async function callJavis(method: JavisDaemonMethod, params: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<unknown> {
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) throw new JavisError('invalid_argument', 'timeoutMs must be a positive integer')
  if (isBrowserDaemonMethod(method)) params = browserDaemonParams(method, params)
  else if (!permissionMethods.has(method)) validateComputerRequestParams(method as JavisMethod, params)
  if (actions.has(method)) await validateComputerProviderActionParams(method as Parameters<typeof validateComputerProviderActionParams>[0], params)
  const target = endpoint()
  await privateDirectory(target.directory)
  let socket: net.Socket
  try { socket = await connect(target.address) }
  catch {
    await assertDaemonRecoveryAvailable(target.lockPath)
    const entry = process.env.JAVIS_CLI_ENTRY ?? process.argv[1]
    if (!entry) throw new JavisError('startup_error', 'JAVIS_CLI_ENTRY is required')
    const child = spawn(process.execPath, [entry, '--internal-daemon'], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {}); child.unref()
    try { socket = await waitConnect(target.address, 10_000) }
    catch (error) { await assertDaemonRecoveryAvailable(target.lockPath); throw error }
  }
  try { return await request(socket, method, params, await readDaemonToken(target), options.timeoutMs) }
  finally { socket.destroy() }
}

export async function connectJavisBrowserStream(options: BrowserStreamOptions): Promise<BrowserStream> {
  await callJavis('browser.status', {})
  const target = endpoint()
  const socket = await connect(target.address)
  const token = await readDaemonToken(target)
  try {
    await request(socket, '__browserStream', { identity: options.identity }, token)
    return createBrowserStreamClient(socket, socket, options, frame => ({ ...frame, token }))
  } catch (error) { socket.destroy(); throw error }
}

export async function stopJavisDaemon(): Promise<void> {
  const target = endpoint()
  let socket: net.Socket
  try { socket = await connect(target.address) }
  catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) return
    throw error
  }
  try { await request(socket, '__shutdown', {}, await readDaemonToken(target)) }
  catch (error) {
    if (process.platform !== 'darwin' || !(error instanceof JavisError) || !/Unknown method/i.test(error.message)) throw error
    await stopLegacyDaemon(target.directory)
  } finally { socket.destroy() }
}

async function stopLegacyDaemon(directory: string): Promise<void> {
  const pid = parseDaemonPid(await readFile(join(directory, 'daemon.lock/pid'), 'utf8'))
  const entry = process.env.JAVIS_CLI_ENTRY ?? process.argv[1]
  if (!pid || !entry) throw new JavisError('access_denied', 'Cannot verify legacy daemon owner')
  const { stdout } = await promisify(execFile)('/bin/ps', ['-p', String(pid), '-o', 'uid=', '-o', 'command='])
  const expected = `${process.execPath} ${entry} --internal-daemon`
  const match = stdout.trim().match(/^(\d+)\s+(.+)$/)
  if (!match || Number(match[1]) !== process.getuid?.() || match[2] !== expected) throw new JavisError('access_denied', 'Legacy daemon command does not match this Javis CLI')
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try { process.kill(pid, 0) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new JavisError('shutdown_timeout', 'Legacy daemon did not stop after SIGTERM')
}

export async function runJavisDaemon(): Promise<void> {
  const target = endpoint()
  await privateDirectory(target.directory)
  try { const existing = await connect(target.address); existing.destroy(); return } catch {}
  let stopping: Promise<void> | undefined
  let deliveryAllowed = () => true
  const provider = createProviderForPlatform(process.platform, {
    stateDirectory: target.directory,
    canDeliver: () => !stopping && deliveryAllowed()
  })
  if (!await acquireDaemonLock(target.lockPath)) { await provider.shutdown(); return }
  try {
  if (!target.namedPipe) await rm(target.address, { force: true })
  const token = randomBytes(32).toString('hex')
  await rm(target.tokenPath, { force: true })
  await writeFile(target.tokenPath, token, { flag: 'wx', mode: 0o600 })
  const runtime = new SessionRuntime(provider)
  const dispatch = createDaemonDispatch(runtime.call.bind(runtime), {
    status: readJavisPermissionStatus,
    open: openJavisPermissions,
    reset: resetJavisPermissions
  }, (method, params, canDeliver) => callBrowser(method, params, {}, canDeliver))
  const hostSubscriptions = new BrowserHostSubscriptions()
  const stopHostRequests = subscribeBrowserEvents(event => {
    if (['browser.host.subscribe', 'browser.host.unsubscribe', 'browser.host.sendBinary', 'browser.host.revoked', 'browser.host.delivery', 'browser.host.flow', 'browser.host.invoke'].includes(event.method)) { void hostSubscriptions.accept(event).catch(() => {}); return }
    if (event.method !== 'browser.host.request') return
    const { id, target, method, params } = event.params
    if (typeof id !== 'string' || typeof target !== 'string' || typeof method !== 'string' || !params || typeof params !== 'object') return
    void dispatchBrowserHostRequest({ target, method, params: params as Record<string, unknown> }).then(response => callBrowser('browser.host.reply', { id, response })).catch(() => {})
  })
  const queue = new DeliveryQueue()
  let active = 0
  const inFlight = new Set<Promise<unknown>>()
  const clients = new Set<net.Socket>()
  const server = net.createServer(socket => {
    clients.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => clients.delete(socket))
    const decoder = new JsonLineDecoder()
    let received = false
    let disconnected = false
    socket.once('end', () => { disconnected = true })
    socket.on('data', chunk => {
      if (received || stopping) { socket.destroy(); return }
      let lines: string[]
      try { lines = decoder.push(chunk) } catch { socket.destroy(); return }
      if (!lines.length) return
      received = true
      let input
      try { input = parseDaemonRequest(lines[0], token) }
      catch (error) {
        const code = error instanceof JavisError ? error.code : 'invalid_argument'
        socket.end(JSON.stringify({ id: 1, ok: false, error: { code, message: error instanceof Error ? error.message : 'Invalid request' } }) + '\n')
        return
      }
      if (input.method === '__shutdown') { void shutdown(socket, input.id); return }
      if (input.method === '__browserStream') {
        const identity = input.params.identity as Record<string, unknown> | undefined
        if (!identity || typeof identity.pairedDeviceId !== 'string' || !identity.pairedDeviceId || !['runtime', 'mobile'].includes(String(identity.clientKind))) { socket.destroy(); return }
        socket.removeAllListeners('data')
        active++; clearTimeout(idle)
        serveBrowserDaemonStream(socket, { pairedDeviceId: identity.pairedDeviceId, clientKind: identity.clientKind as 'runtime' | 'mobile', clientCapabilities: Array.isArray(identity.clientCapabilities) ? identity.clientCapabilities.filter((v): v is string => typeof v === 'string') : [] }, token, () => {
          active--
          if (!active && !stopping) idle = setTimeout(() => { void shutdown() }, 300_000)
        })
        socket.write(JSON.stringify({ id: input.id, ok: true, result: { connected: true } }) + '\n')
        return
      }
      const deadline = Date.now() + (isBrowserDaemonMethod(input.method) ? Math.max(90_000, typeof input.params.timeout === 'number' ? input.params.timeout + 30_000 : 0) : 60_000)
      active++; clearTimeout(idle)
      const complete = (operation: Promise<unknown>) => {
        inFlight.delete(operation)
        active--
        if (!active && !stopping) idle = setTimeout(() => { void shutdown() }, 300_000)
      }
      if (permissionMethods.has(input.method) || isBrowserDaemonMethod(input.method)) {
        const canDeliver = () => !disconnected && !socket.destroyed && !stopping && Date.now() < deadline
        const operation = dispatch(input.method as JavisDaemonMethod, input.params, canDeliver)
        inFlight.add(operation)
        void operation.then(
          result => { if (!socket.destroyed) socket.end(JSON.stringify({ id: input.id, ok: true, result }) + '\n') },
          error => { if (!socket.destroyed) socket.end(JSON.stringify({ id: input.id, ok: false, error: runtimeErrorDetails(error) }) + '\n') }
        ).then(() => complete(operation), () => complete(operation))
        return
      }
      const operation = queue.enqueue(() => !disconnected && !socket.destroyed, deadline, async () => {
        deliveryAllowed = () => !disconnected && !socket.destroyed && Date.now() < deadline
        let reply
        try { reply = { id: input.id, ok: true, result: await dispatch(input.method as JavisDaemonMethod, input.params, deliveryAllowed) } }
        catch (error) { reply = { id: input.id, ok: false, error: runtimeErrorDetails(error) } }
        if (!deliveryAllowed() && (input.method === 'getAppState' || actions.has(input.method))) {
          const result = 'result' in reply && reply.result && typeof reply.result === 'object' ? reply.result as Record<string, unknown> : {}
          runtime.invalidateObservation({ ...input.params, ...(input.params.sessionId === undefined && input.params.worktree === undefined && typeof result.sessionId === 'string' ? { sessionId: result.sessionId } : {}) })
        }
        if (!socket.destroyed) socket.end(JSON.stringify(reply) + '\n')
      })
      inFlight.add(operation)
      void operation.then(() => complete(operation), () => complete(operation))
    })
  })
  const shutdown = (replySocket?: net.Socket, id = 1): Promise<void> => {
    stopping ??= (async () => {
      clearTimeout(idle)
      queue.stop()
      cancelJavisPermissionOperations()
      stopHostRequests()
      await hostSubscriptions.close()
      await closeBrowserHostConnections()
      await stopBrowserProcess()
      await provider.shutdown()
      await Promise.allSettled([...inFlight])
      if (!target.namedPipe) await rm(target.address, { force: true })
      await rm(target.tokenPath, { force: true })
      await rm(target.lockPath, { recursive: true, force: true })
      if (replySocket && !replySocket.destroyed) await new Promise<void>(resolve => replySocket.end(JSON.stringify({ id, ok: true, result: { stopped: true } }) + '\n', resolve))
      for (const client of clients) client.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    })()
    return stopping
  }
  let idle = setTimeout(() => { void shutdown() }, 300_000)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    if (target.namedPipe) server.listen({ path: target.address, readableAll: false, writableAll: false }, resolve)
    else server.listen(target.address, resolve)
  })
  if (!target.namedPipe) await chmod(target.address, 0o600)
  const onSignal = () => { void shutdown() }
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal)
  await new Promise<void>(resolve => server.once('close', resolve))
  process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal)
  } catch (error) {
    await stopBrowserProcess().catch(() => {})
    await provider.shutdown().catch(() => {})
    if (!target.namedPipe) await rm(target.address, { force: true })
    await rm(target.tokenPath, { force: true })
    await rm(target.lockPath, { recursive: true, force: true })
    throw error
  }
}
