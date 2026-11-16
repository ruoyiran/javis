import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopScriptRuntimeHost } from '../../src/runtime/desktop-script-provider/windows-host.js'

let directory: string
let scriptPath: string
let reapedPath: string
let receivedPath: string

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'javis-serve-test-'))
  scriptPath = join(directory, 'serve.cjs')
  reapedPath = join(directory, 'reaped')
  receivedPath = join(directory, 'received')
  await writeFile(scriptPath, `
const fs = require('node:fs')
let ready = false
setTimeout(() => { ready = true; process.stdout.write('{"ready":true}\\n') }, 40)
process.stdin.on('data', (chunk) => {
  fs.writeFileSync(${JSON.stringify(receivedPath)}, chunk)
  if (!ready) {
    const request = JSON.parse(chunk.toString())
    process.stdout.write(JSON.stringify({requestId: request.requestId, ok: false, error: 'sent before ready'}) + '\\n')
  }
})
process.on('SIGTERM', () => {
  setTimeout(() => { fs.writeFileSync(${JSON.stringify(reapedPath)}, 'closed'); process.exit(0) }, 60)
})
`)
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

it('waits for serve readiness and reaps a timed-out action before rejecting it', async () => {
  const host = new DesktopScriptRuntimeHost(scriptPath, {
    requestTimeoutMs: 250,
    spawn: () => spawn(process.execPath, [scriptPath], { stdio: 'pipe' }) as ChildProcessWithoutNullStreams
  })
  try {
    await expect(host.request({ tool: 'click', app: 'Demo', x: 1, y: 2 })).rejects.toMatchObject({
      code: 'action_timeout'
    })
    expect(await readFile(reapedPath, 'utf8')).toBe('closed')
  } finally {
    await host.dispose()
  }
})

it('does not send an action after the caller disconnects during serve startup', async () => {
  await rm(receivedPath, { force: true })
  let allowed = true
  let started = false
  const host = new DesktopScriptRuntimeHost(scriptPath, {
    requestTimeoutMs: 500,
    canDeliver: () => allowed,
    spawn: () => {
      started = true
      const child = spawn(process.execPath, [scriptPath], { stdio: 'pipe' }) as ChildProcessWithoutNullStreams
      allowed = false
      return child
    }
  })
  try {
    await expect(host.request({ tool: 'click', app: 'Demo', x: 1, y: 2 })).rejects.toMatchObject({
      code: 'action_timeout'
    })
    expect(started).toBe(true)
    await expect(stat(receivedPath)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await host.dispose()
  }
})
