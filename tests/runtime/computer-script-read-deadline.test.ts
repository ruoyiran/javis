import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { readFile } from 'node:fs/promises'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ exec: undefined as undefined | ((...args: unknown[]) => unknown) }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: (...args: unknown[]) => fixture.exec!(...args) }))
import { DesktopScriptProviderClient } from '../../src/runtime/desktop-script-provider/client.js'
import { DesktopScriptRuntimeHost } from '../../src/runtime/desktop-script-provider/windows-host.js'

const capabilities = { protocolVersion: 1, platform: 'linux', provider: 'fixture', providerVersion: '1', supports: { apps: { list: true }, windows: { list: true, targetById: true, targetByIndex: true }, observation: {}, actions: {}, surfaces: {} } }
const windows = { ok: true, app: { name: 'Fixture', bundleId: null, pid: 12 }, windows: [{ index: 0, app: { name: 'Fixture', bundleId: null, pid: 12 }, title: 'Ready', width: 100, height: 100 }] }
afterEach(() => { vi.useRealTimers(); fixture.exec = undefined })

test.each(['one-shot', 'serve'])('%s script read finishes after the default provider deadline', async route => {
  let answer!: () => void
  let began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  const respond = (request: { tool: string }, send: (response: unknown) => void) => {
    if (request.tool === 'handshake') send({ ok: true, capabilities })
    else { answer = () => send(windows); began() }
  }
  fixture.exec = (...args) => {
    const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void
    let closed = false
    void readFile((args[1] as string[])[1], 'utf8').then(json => respond(JSON.parse(json), response => {
      if (!closed) { closed = true; callback(null, JSON.stringify(response), '') }
    }))
    return { kill: () => { if (!closed) { closed = true; callback(Object.assign(new Error('terminated'), { killed: true }), '', '') }; return true } }
  }
  const host = route === 'serve' ? new DesktopScriptRuntimeHost('fixture.ps1', { warn: () => {}, spawn: () => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    const stdout = new PassThrough()
    child.stdout = stdout; child.stderr = new PassThrough()
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(chunk.toString())
      respond(request, response => stdout.write(JSON.stringify({ ...response as object, requestId: request.requestId }) + '\n'))
      done()
    } })
    child.kill = () => { child.emit('close', 0, null); return true }
    queueMicrotask(() => stdout.write('{"ready":true}\n'))
    return child
  } }) : null
  const provider = new DesktopScriptProviderClient(route === 'serve' ? 'win32' : 'linux', 'fixture.py', host)
  try {
    await provider.call('handshake', {})
    vi.useFakeTimers()
    const reading = provider.call('listWindows', { app: 'Fixture' }, { deadline: Date.now() + 120_000 })
    const completed = reading.then(result => ({ result }), error => ({ error }))
    await started
    let queuedFailure: unknown
    let nextStarted: Promise<void> | undefined
    let queued: Promise<unknown> | undefined
    if (route === 'serve') {
      nextStarted = new Promise<void>(resolve => { began = resolve })
      queued = provider.call('listWindows', { app: 'Fixture' }, { deadline: Date.now() + 120_000 }).catch(error => { queuedFailure = error })
    }
    await vi.advanceTimersByTimeAsync(70_000)
    expect(queuedFailure).toBeUndefined()
    answer()
    expect(await completed).toMatchObject({ result: { windows: [{ title: 'Ready' }] } })
    if (queued) {
      await nextStarted
      await vi.advanceTimersByTimeAsync(40_000)
      answer()
      expect(await queued).toMatchObject({ windows: [{ title: 'Ready' }] })
    }
  } finally { vi.useRealTimers(); await provider.shutdown() }
})
