import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
export function matchingHelperPids(list:string,command:string,uid:number):number[] {
 return list.split('\n').flatMap(line=>{
  const match=line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
  if(!match || Number(match[1])!==uid || match[3]!==command)return []
  const pid=Number(match[2])
  return Number.isSafeInteger(pid)&&pid>1?[pid]:[]
 })
}
async function matching(command:string,pid?:number):Promise<number[]> {
 const args=['-ww',...(pid?['-p',String(pid)]:['-ax']),'-o','uid=','-o','pid=','-o','command=']
 try {const {stdout}=await promisify(execFile)('/bin/ps',args);return matchingHelperPids(stdout,command,process.getuid!())}
 catch(error){if((error as {code?:unknown}).code===1)return [];throw error}
}
export async function reapHelper(command:string):Promise<void> {
 const pids=await matching(command)
 const signal=async(pid:number,value:NodeJS.Signals)=>{
  if(!(await matching(command,pid)).includes(pid))return
  try {process.kill(pid,value)} catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error}
 }
 for(const pid of pids)await signal(pid,'SIGTERM')
 if(!pids.length)return
 await new Promise(resolve=>setTimeout(resolve,1000))
 for(const pid of pids)await signal(pid,'SIGKILL')
}
