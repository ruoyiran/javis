import { afterEach, expect, test, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const operations = vi.hoisted(() => ({
  status: async (): Promise<unknown> => ({}),
  open: async (): Promise<unknown> => ({}),
  reset: async (): Promise<unknown> => ({}),
  cancel: () => {}
}))
vi.mock('../../src/permissions.js', () => ({
  readJavisPermissionStatus: () => operations.status(),
  openJavisPermissions: () => operations.open(),
  resetJavisPermissions: () => operations.reset(),
  cancelJavisPermissionOperations: () => operations.cancel()
}))
vi.mock('../../src/runtime/provider-selection.js', () => ({ createProviderForPlatform: () => ({ call: async () => ({}), shutdown: async () => {} }) }))
import { callJavis, runJavisDaemon, stopJavisDaemon } from '../../src/runtime/public.js'

const directories: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function start() {
  const directory = await mkdtemp(join(tmpdir(), 'javis-permission-concurrency-'))
  directories.push(directory)
  vi.stubEnv('JAVIS_STATE_DIR', directory)
  const daemon = runJavisDaemon()
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await stat(join(directory, 'daemon.sock')); break }
    catch { await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  return { daemon }
}

test.runIf(process.platform === 'darwin')('reset reaches the permission gate while a status probe is pending', async () => {
  let beginStatus!: () => void
  let finishStatus!: (value: unknown) => void
  const started = new Promise<void>(resolve => { beginStatus = resolve })
  operations.status = () => { beginStatus(); return new Promise(resolve => { finishStatus = resolve }) }
  operations.reset = async () => ({ reset: true })
  const { daemon } = await start()
  const statusRequest = callJavis('permissionsStatus', {})
  try {
    await started
    const resetRequest = callJavis('permissionsReset', {})
    const completed = await Promise.race([resetRequest.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))])
    expect(completed).toBe(true)
    finishStatus({ platform: 'darwin' })
    await resetRequest
    await statusRequest
  } finally {
    finishStatus?.({ platform: 'darwin' })
    await statusRequest.catch(() => {})
    await stopJavisDaemon()
    await daemon
  }
})

test.runIf(process.platform === 'darwin')('shutdown waits for a permission operation already in progress', async () => {
  let beginOpen!: () => void
  let finishOpen!: () => void
  const started = new Promise<void>(resolve => { beginOpen = resolve })
  operations.open = () => { beginOpen(); return new Promise<void>(resolve => { finishOpen = resolve }) }
  const { daemon } = await start()
  const opening = callJavis('permissionsOpen', {})
  void opening.catch(() => {})
  try {
    await started
    let stopped = false
    const stopping = stopJavisDaemon().then(() => { stopped = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(stopped).toBe(false)
    finishOpen()
    await stopping
  } finally {
    finishOpen?.()
    await opening.catch(() => {})
    await stopJavisDaemon()
    await daemon
  }
})
