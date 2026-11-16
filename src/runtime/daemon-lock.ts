import { mkdir, readFile, writeFile, stat, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { JavisError } from './error.js'
import { randomUUID } from 'node:crypto'
export function parseDaemonPid(text:string):number|null {
 if(!/^[1-9]\d*$/.test(text.trim()))return null
 const pid=Number(text.trim())
 return Number.isSafeInteger(pid)&&pid>1?pid:null
}
export async function acquireDaemonLock(path:string):Promise<boolean> {
 const guard=path+'.recovery'
 try {await mkdir(guard,{mode:0o700})} catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST'){await assertDaemonRecoveryAvailable(path);return false};throw error}
 try {return await acquireGuardedLock(path)} finally {await rm(guard,{recursive:true,force:true})}
}
async function acquireGuardedLock(path:string):Promise<boolean> {
 try {await mkdir(path,{mode:0o700})} catch(error) {
  if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
  let pid:number|null=null
  try {pid=parseDaemonPid(await readFile(join(path,'pid'),'utf8'))} catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  if(pid!==null){try {process.kill(pid,0);return false} catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')return false}}
  else if(Date.now()-(await stat(path)).mtimeMs<2000)return false
  const abandoned=path+'.abandoned-'+randomUUID()
  try {await rename(path,abandoned)} catch{return false}
  await rm(abandoned,{recursive:true,force:true})
  try {await mkdir(path,{mode:0o700})} catch{return false}
 }
 await writeFile(join(path,'pid'),String(process.pid),{mode:0o600})
 return true
}

export async function assertDaemonRecoveryAvailable(path:string):Promise<void> {
 const guard=path+'.recovery'
 let info
 try {info=await stat(guard)} catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
 if(Date.now()-info.mtimeMs>2000)throw new JavisError('daemon_recovery_blocked',`Javis startup is blocked by recovery guard ${guard}. Check that no Javis daemon startup is running, then remove that recovery directory and retry.`)
}
