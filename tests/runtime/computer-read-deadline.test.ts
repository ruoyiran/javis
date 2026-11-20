import net from 'node:net'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  call: async (_method: string, _params: Record<string, unknown>, _options?: { deadline?: number }): Promise<unknown> => ({}),
  canDeliver: (() => true) as () => boolean,
  ssh: undefined as undefined | ((...args: unknown[]) => unknown)
}))
vi.mock('../../src/runtime/provider-selection.js', () => ({ createProviderForPlatform: (_platform: string, options: { canDeliver: () => boolean }) => {
  fixture.canDeliver = options.canDeliver
  return { call: (method: string, params: Record<string, unknown>, options?: { deadline?: number }) => fixture.call(method, params, options), shutdown: async () => {} }
} }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: (...args: unknown[]) => {
  if (!fixture.ssh) throw new Error('Unexpected process launch')
  return fixture.ssh(...args)
} }))
import { callJavis, runJavisDaemon, stopJavisDaemon } from '../../src/runtime/public.js'
import { callRemoteJavis, runJavisStdioRpc } from '../../src/runtime/remote-stdio.js'
import { JavisError } from '../../src/runtime/error.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); fixture.ssh = undefined })

function loopbackSsh() {
  fixture.ssh = () => {
    const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean }
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = () => { child.emit('close', null, 'SIGTERM'); return true }
    void runJavisStdioRpc(child.stdin, child.stdout).then(() => child.emit('close', 0, null), error => child.emit('error', error))
    return child
  }
}

test.skipIf(process.platform === 'win32').each(['local', 'ssh'])('%s read allowance survives daemon queue time and reaches the provider', async route => {
  const directory = await mkdtemp(join(tmpdir(), 'javis-read-deadline-'))
  vi.stubEnv('JAVIS_STATE_DIR', directory)
  let clock = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  let release!: () => void
  let begin!: () => void
  const started = new Promise<void>(resolve => { begin = resolve })
  const occupied = new Promise<void>(resolve => { release = resolve })
  let received!: () => void
  const queued = new Promise<void>(resolve => { received = resolve })
  const createServer = net.createServer.bind(net)
  vi.spyOn(net, 'createServer').mockImplementation(((listener: (socket: net.Socket) => void) => createServer(socket => {
    listener(socket)
    socket.on('data', chunk => {
      if (chunk.toString().includes('waiting-folder')) received()
    })
  })) as typeof net.createServer)
  fixture.call = async (method, params, options) => {
    if (method === 'handshake') return { supports: { observation: {} } }
    if (params.worktree === 'occupier') { begin(); await occupied }
    else {
      clock = 111_000
      if (!options?.deadline || clock >= options.deadline || !fixture.canDeliver()) throw new JavisError('action_timeout', 'Read allowance was lost')
    }
    return { snapshot: { id: 'late', app: { name: 'Fixture', bundleId: null, pid: 12 }, window: { id: 7, index: 0, title: 'Ready', width: 100, height: 100 }, coordinateSpace: 'window', treeText: '0 window Ready', elementCount: 1, focusedElementId: null }, screenshot: null }
  }
  if (route === 'ssh') loopbackSsh()
  const daemon = runJavisDaemon()
  for (;;) {
    try { await stat(join(directory, 'daemon.sock')); break }
    catch { await new Promise(resolve => setTimeout(resolve, 5)) }
  }
  const first = callJavis('getAppState', { app: 'Fixture', worktree: 'occupier' }, { timeoutMs: 120_000 })
  await started
  const params = { app: 'Fixture', worktree: 'waiting-folder' }
  const reading = route === 'local' ? callJavis('getAppState', params, { timeoutMs: 120_000 }) : callRemoteJavis('getAppState', params, 'fixture-host', { timeoutMs: 120_000 })
  let reply: unknown
  let failure: unknown
  void reading.then(result => { reply = result }, error => { failure = error })
  try {
    await queued
    clock = 71_000
    release()
    await first
    await callJavis('capabilities', {})
    await new Promise(resolve => setImmediate(resolve))
    expect(failure).toBeUndefined()
    expect(reply).toMatchObject({ snapshot: { id: 'late' }, sessionId: 'worktree:waiting-folder' })
  } finally {
    release()
    await stopJavisDaemon()
    await Promise.allSettled([first, reading])
    await daemon
    await rm(directory, { recursive: true, force: true })
  }
})
