import { it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, utimes, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('node:fs/promises', async importOriginal => {
 const fs=await importOriginal<typeof import('node:fs/promises')>()
 return {...fs,stat:async (...args:Parameters<typeof fs.stat>)=>{const result=await fs.stat(...args);await new Promise(resolve=>setTimeout(resolve,10));return result}}
})
import { acquireDaemonLock } from '../../src/runtime/daemon-lock.js'
it('recovers abandoned empty locks while preserving a newly created lock',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'javis-lock-')), lock=join(dir,'lock')
 try {
  await mkdir(lock)
  expect(await acquireDaemonLock(lock)).toBe(false)
  await utimes(lock,new Date(0),new Date(0))
  expect(await acquireDaemonLock(lock)).toBe(true)
 } finally {await rm(dir,{recursive:true,force:true})}
})
it('allows exactly one concurrent stale-lock replacement',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'javis-lock-race-')), lock=join(dir,'lock')
 try {
  await mkdir(lock);await utimes(lock,new Date(0),new Date(0))
  const results=await Promise.all(Array.from({length:16},()=>acquireDaemonLock(lock)))
  expect(results.filter(Boolean)).toHaveLength(1)
 } finally {await rm(dir,{recursive:true,force:true})}
})
it('reports an abandoned recovery guard without removing it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'javis-guard-')), lock=join(dir,'lock'),guard=lock+'.recovery'
 try {
  await mkdir(guard);await utimes(guard,new Date(0),new Date(0))
  await expect(acquireDaemonLock(lock)).rejects.toMatchObject({code:'daemon_recovery_blocked'})
  await expect(stat(guard)).resolves.toBeDefined()
 } finally {await rm(dir,{recursive:true,force:true})}
})
