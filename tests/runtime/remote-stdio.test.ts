import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { callRemoteJavis, runJavisStdioRpc } from '../../src/runtime/remote-stdio.js'

async function withFakeSsh<T>(source: string, run: (script: string, directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'javis-remote-test-'))
  const script = join(directory, 'ssh.mjs')
  try {
    await writeFile(script, source)
    return await run(script, directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function sshOptions(script: string, options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
  return { sshExecutable: process.execPath, sshPrefixArgs: [script], ...options }
}

async function stdioReply(request: string, callLocal: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  let output = ''
  const writer = new Writable({
    write(chunk, _encoding, done) {
      output += chunk.toString()
      done()
    }
  })
  await runJavisStdioRpc(Readable.from([request]), writer, callLocal)
  return JSON.parse(output)
}

describe('remote Javis stdio transport', () => {
  it('sends a single JSONL request to the selected SSH alias using fixed command arguments', async () => {
    await withFakeSsh(`
      let request = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', chunk => { request += chunk })
      process.stdin.on('end', () => {
        const input = JSON.parse(request.trim())
        process.stdout.write(JSON.stringify({
          id: input.id, ok: true,
          result: {
            argv: process.argv.slice(2), method: input.method, params: input.params,
            framed: request.endsWith('\\n') && request.indexOf('\\n') === request.length - 1
          }
        }) + '\\n')
      })
    `, async script => {
      const result = await callRemoteJavis('getAppState', { app: 'Finder', worktree: 'cwd:/projects/folder' }, 'devbox', sshOptions(script))
      expect(result).toEqual({
        argv: ['-T', '-o', 'BatchMode=yes', 'devbox', 'javis', 'rpc', '--stdio'],
        method: 'getAppState',
        params: { app: 'Finder', worktree: 'cwd:/projects/folder' },
        framed: true
      })
    })
  })

  it('rejects an SSH option disguised as a host before spawning', async () => {
    await expect(callRemoteJavis('listApps', {}, '-oProxyCommand=sh', { sshExecutable: '/missing/ssh' }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('rejects an unserializable request before starting SSH', async () => {
    const params: Record<string, unknown> = {}
    params.loop = params
    await expect(callRemoteJavis('listApps', params, 'devbox', { sshExecutable: '/missing/ssh' }))
      .rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('preserves the remote Javis error code and message', async () => {
    await withFakeSsh(`
      process.stdin.resume()
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({
          id: 1, ok: false, error: { code: 'stale_snapshot', message: 'Refresh observation' }
        }) + '\\n')
      })
    `, async script => {
      await expect(callRemoteJavis('click', { sessionId: 'old' }, 'devbox', sshOptions(script)))
        .rejects.toMatchObject({ code: 'stale_snapshot', message: 'Refresh observation' })
    })
  })

  it('reports uncertain delivery after a disconnected action without replaying it', async () => {
    await withFakeSsh(`
      import { appendFileSync } from 'node:fs'
      process.stdin.resume()
      process.stdin.on('end', () => {
        appendFileSync(${JSON.stringify('LOG_PATH_PLACEHOLDER')}, '1\\n')
        process.exit(42)
      })
    `, async (script, directory) => {
      const log = join(directory, 'launches')
      const source = await readFile(script, 'utf8')
      await writeFile(script, source.replace('"LOG_PATH_PLACEHOLDER"', JSON.stringify(log)))
      await expect(callRemoteJavis('click', { sessionId: 'recent' }, 'devbox', sshOptions(script)))
        .rejects.toMatchObject({ code: 'transport_error', message: expect.stringMatching(/delivery may be uncertain/i) })
      expect(await readFile(log, 'utf8')).toBe('1\n')
    })
  })

  it('kills a remote call at its deadline and reports action_timeout', async () => {
    await withFakeSsh(`process.stdin.resume(); setInterval(() => {}, 1000)`, async script => {
      await expect(callRemoteJavis('click', { sessionId: 'recent' }, 'devbox', sshOptions(script, { timeoutMs: 100 })))
        .rejects.toMatchObject({ code: 'action_timeout', message: expect.stringMatching(/delivery may be uncertain/i) })
    })
  })

  it('rejects an oversized response without exposing its contents', async () => {
    await withFakeSsh(`
      process.stdin.resume()
      process.stdin.on('end', () => process.stdout.write('sensitive'.repeat(128) + '\\n'))
    `, async script => {
      await expect(callRemoteJavis('listApps', {}, 'devbox', sshOptions(script, { maxResponseBytes: 100 })))
        .rejects.toMatchObject({ code: 'transport_error', message: expect.not.stringContaining('sensitive') })
    })
  })
})

describe('local stdio RPC bridge', () => {
  it('reads permission status without forwarding it to the computer daemon', async () => {
    let output = ''
    const writer = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done() } })
    await runJavisStdioRpc(
      Readable.from(['{"id":9,"method":"permissionsStatus","params":{}}\n']),
      writer,
      async () => { throw new Error('computer daemon should not receive permission status') },
      async () => ({ platform: 'darwin', permissions: [{ id: 'accessibility', status: 'granted' }] })
    )
    expect(JSON.parse(output)).toEqual({ id: 9, ok: true, result: { platform: 'darwin', permissions: [{ id: 'accessibility', status: 'granted' }] } })
  })
  it('passes an allowed method to the local daemon and returns one result envelope', async () => {
    const result = await stdioReply('{"id":7,"method":"listWindows","params":{"app":"Finder"}}\n', async (method, params) => ({ method, params }))
    expect(result).toEqual({ id: 7, ok: true, result: { method: 'listWindows', params: { app: 'Finder' } } })
  })

  it('uses empty parameters when a method does not supply them', async () => {
    const result = await stdioReply('{"id":2,"method":"capabilities"}\n', async (_method, params) => params)
    expect(result).toEqual({ id: 2, ok: true, result: {} })
  })

  it.each([
    { method: 'getAppState', params: { app: 'Fixture' }, timeoutMs: 120001 },
    { method: 'getAppState', params: { app: 'Fixture', restoreWindow: true }, timeoutMs: 120000 },
    { method: 'click', params: { app: 'Fixture' }, timeoutMs: 120000 }
  ])('rejects an SSH envelope that would extend passive bounds or input delivery: %j', async request => {
    const result = await stdioReply(JSON.stringify({ id: 1, ...request }) + '\n', async () => { throw new Error('Invalid deadline reached the daemon') })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })

  it.each(['__shutdown', 'permissionsOpen', 'unknown'])('rejects disallowed method %s before daemon delivery', async method => {
    let delivered = false
    const result = await stdioReply(JSON.stringify({ id: 1, method, params: {} }) + '\n', async () => {
      delivered = true
      return {}
    })
    expect(result).toMatchObject({ id: 1, ok: false, error: { code: 'invalid_argument' } })
    expect(delivered).toBe(false)
  })

  it('rejects multiple requests instead of delivering either one', async () => {
    let delivered = false
    const result = await stdioReply('{"id":1,"method":"listApps","params":{}}\n{"id":2,"method":"listApps","params":{}}\n', async () => {
      delivered = true
      return {}
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(delivered).toBe(false)
  })

  it('does not echo malformed request contents in an error reply', async () => {
    const result = await stdioReply('{"secret":"sensitive",broken}\n', async () => ({}))
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(JSON.stringify(result)).not.toContain('sensitive')
  })

  it('preserves local daemon error codes and maps unexpected failures to internal_error', async () => {
    const request = '{"id":3,"method":"listApps","params":{}}\n'
    const typed = await stdioReply(request, async () => { throw Object.assign(new Error('Refresh observation'), { code: 'stale_snapshot' }) })
    const unexpected = await stdioReply(request, async () => { throw new Error('Daemon failed') })
    expect(typed).toMatchObject({ id: 3, ok: false, error: { code: 'stale_snapshot', message: 'Refresh observation' } })
    expect(unexpected).toMatchObject({ id: 3, ok: false, error: { code: 'internal_error', message: 'Daemon failed' } })
  })
})
