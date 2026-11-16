import { expect, test, vi } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const calls = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), execFile: calls.launch }))
vi.mock('../../src/runtime/provider-selection.js', () => ({ createProviderForPlatform: () => ({ call: async () => ({}), shutdown: async () => {} }) }))
import { callJavis, runJavisDaemon, stopJavisDaemon } from '../../src/runtime/public.js'

test.runIf(process.platform === 'darwin')('shares one permission probe across separate daemon clients', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'javis-permission-daemon-'))
  vi.stubEnv('JAVIS_STATE_DIR', directory)
  calls.launch.mockImplementation((_command, args, _options, callback) => {
    void writeFile(args.at(-1), JSON.stringify({ accessibility: 'granted', screenshots: 'granted' }))
      .then(() => callback(null, '', ''))
  })
  const daemon = runJavisDaemon()
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await stat(join(directory, 'daemon.sock')); break }
      catch { await new Promise(resolve => setTimeout(resolve, 10)) }
    }
    const [first, second] = await Promise.all([
      callJavis('permissionsStatus', {}),
      callJavis('permissionsStatus', {})
    ])
    expect(first).toEqual(second)
    expect(calls.launch).toHaveBeenCalledTimes(1)
  } finally {
    await stopJavisDaemon()
    await daemon
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  }
})
