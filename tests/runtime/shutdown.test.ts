import { it, expect, vi } from 'vitest'
import { mkdtemp, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const state = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => state.home }))
it.runIf(process.platform === 'darwin')('acknowledges shutdown and removes owned daemon state', async () => {
 state.home = await mkdtemp(join(tmpdir(), 'javis-shutdown-'))
 const { runJavisDaemon, stopJavisDaemon } = await import('../../src/runtime/public.js')
 const daemon = runJavisDaemon()
 const directory = join(state.home,'Library/Application Support/Javis')
 for(let count=0;count<100;count++) { try { await stat(join(directory,'daemon.sock'));break } catch { await new Promise(resolve=>setTimeout(resolve,10)) } }
 try {
   await stopJavisDaemon()
   await daemon
   await expect(stat(join(directory,'daemon.sock'))).rejects.toMatchObject({code:'ENOENT'})
   await expect(stat(join(directory,'daemon.lock'))).rejects.toMatchObject({code:'ENOENT'})
   await stopJavisDaemon()
 } finally { await rm(state.home,{recursive:true,force:true}) }
})
