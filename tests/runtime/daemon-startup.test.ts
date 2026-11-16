import { expect, test, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => state.home }))
vi.mock('../../src/runtime/provider-selection.js', () => ({
  createProviderForPlatform: () => { throw new Error('missing native provider') }
}))
import { runJavisDaemon } from '../../src/runtime/public.js'

test.runIf(process.platform === 'darwin')('removes owned startup state when the provider cannot initialize', async () => {
  state.home = await mkdtemp(join(tmpdir(), 'javis-startup-'))
  const directory = join(state.home, 'Library/Application Support/Javis')
  try {
    await expect(runJavisDaemon()).rejects.toThrow('missing native provider')
    await expect(stat(join(directory, 'daemon.token'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(join(directory, 'daemon.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(state.home, { recursive: true, force: true }) }
})
