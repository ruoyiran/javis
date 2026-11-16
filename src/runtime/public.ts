import net from 'node:net'
import { reapHelper } from './helper-reaping.js'
import { launchHelperApp } from './helper-launch.js'
import { validateHelperStartup } from './helper-startup.js'
import { promisify } from 'node:util'
import { acquireDaemonLock, assertDaemonRecoveryAvailable, parseDaemonPid } from './daemon-lock.js'
import { JsonLineDecoder, DeliveryQueue } from './transport.js'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdir, chmod, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { JavisError } from './error.js'
import { SessionRuntime, type JavisMethod } from './session.js'
export { JavisError }
export type { JavisMethod }
const directory = join(homedir(), 'Library/Application Support/Javis')
const socketPath = join(directory, 'daemon.sock')
function platform(): void { if (process.platform !== 'darwin') throw new JavisError('unsupported_platform','Javis requires macOS') }
async function privateDirectory(): Promise<void> {
  await mkdir(directory,{recursive:true,mode:0o700})
  const info = await stat(directory)
  if (info.uid !== process.getuid?.()) throw new JavisError('access_denied','Javis state directory must be owned by current user')
  await chmod(directory,0o700)
}
async function connect(path: string): Promise<net.Socket> {
  return new Promise((resolve,reject) => {
    const socket = net.createConnection(path)
    socket.once('connect',()=>{socket.removeListener('error',reject);resolve(socket)})
    socket.once('error',reject)
  })
}
async function waitConnect(path:string, milliseconds:number): Promise<net.Socket> {
  const deadline = Date.now()+milliseconds
  while (true) {
    try { return await connect(path) } catch (error) {
      if (Date.now() >= deadline) throw new JavisError('startup_timeout',String(error))
      await new Promise(resolve=>setTimeout(resolve,50))
    }
  }
}
function request(socket:net.Socket, method:string, params:Record<string,unknown>, token?:string):Promise<unknown> {
  return new Promise((resolve,reject)=>{
    const decoder = new JsonLineDecoder()
    const cleanup = () => { clearTimeout(timer); socket.off('data',data);socket.off('close',closed);socket.off('error',failed) }
    const failed = (error:Error) => {cleanup();reject(new JavisError('transport_error',error.message))}
    const closed = () => failed(new Error('Connection closed; action delivery may be uncertain'))
    const data = (chunk:Buffer) => {
      let lines: string[]
      try { lines=decoder.push(chunk) } catch(error) { failed(error as Error);return }
      if (!lines.length) return
      cleanup()
      try { const reply=JSON.parse(lines[0]); if(reply.ok)resolve(reply.result);else reject(new JavisError(reply.error.code,reply.error.message)) } catch(error){reject(error)}
    }
    const timer=setTimeout(()=>{failed(new JavisError('action_timeout','Request timed out; action delivery may be uncertain'));socket.destroy()},60_000)
    socket.on('data',data);socket.once('close',closed);socket.once('error',failed)
    socket.write(JSON.stringify({id:1,method,params,token})+'\n',error=>{if(error)failed(error)})
  })
}
export async function callJavis(method:JavisMethod,params:Record<string,unknown>):Promise<unknown> {
  platform();await privateDirectory()
  let socket:net.Socket
  try { socket=await connect(socketPath) } catch {
    await assertDaemonRecoveryAvailable(join(directory,'daemon.lock'))
    const entry=process.env.JAVIS_CLI_ENTRY ?? process.argv[1]
    if(!entry)throw new JavisError('startup_error','JAVIS_CLI_ENTRY is required')
    const child=spawn(process.execPath,[entry,'--internal-daemon'],{detached:true,stdio:'ignore'})
    child.on('error',()=>{});child.unref()
    try {socket=await waitConnect(socketPath,10_000)} catch(error){await assertDaemonRecoveryAvailable(join(directory,'daemon.lock'));throw error}
  }
  try {return await request(socket,method,params)} finally {socket.destroy()}
}
export async function stopJavisDaemon(): Promise<void> {
  platform()
  let socket: net.Socket
  try { socket = await connect(socketPath) } catch (error) {
    if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) return
    throw error
  }
  try { await request(socket, '__shutdown', {}) } catch(error) {
    if (!(error instanceof JavisError) || !/Unknown method/i.test(error.message)) throw error
    await stopLegacyDaemon()
  } finally { socket.destroy() }
}
async function stopLegacyDaemon():Promise<void> {
  const pid=parseDaemonPid(await readFile(join(directory,'daemon.lock/pid'),'utf8'))
  const entry=process.env.JAVIS_CLI_ENTRY ?? process.argv[1]
  if(!pid || !entry)throw new JavisError('access_denied','Cannot verify legacy daemon owner')
  const {stdout}=await promisify(execFile)('/bin/ps',['-p',String(pid),'-o','uid=','-o','command='])
  const expected=`${process.execPath} ${entry} --internal-daemon`
  const match=stdout.trim().match(/^(\d+)\s+(.+)$/)
  if(!match || Number(match[1])!==process.getuid?.() || match[2]!==expected)throw new JavisError('access_denied','Legacy daemon command does not match this Javis CLI')
  process.kill(pid,'SIGTERM')
  const deadline=Date.now()+10_000
  while(Date.now()<deadline){
    try {process.kill(pid,0)} catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return;throw error}
    await new Promise(resolve=>setTimeout(resolve,50))
  }
  throw new JavisError('shutdown_timeout','Legacy daemon did not stop after SIGTERM')
}
export async function runJavisDaemon():Promise<void> {
  platform();await privateDirectory()
  try { const existing=await connect(socketPath);existing.destroy();return } catch {}
  const lockPath=join(directory,'daemon.lock')
  if (!await acquireDaemonLock(lockPath)) return
  await rm(socketPath,{force:true})
  let helper:ChildProcess|undefined, nativeSocket:net.Socket|undefined
  const nativeDirectory=join(directory,randomUUID())
  await mkdir(nativeDirectory,{mode:0o700})
  const token=randomUUID(), tokenPath=join(nativeDirectory,'token'), helperSocket=join(nativeDirectory,'helper.sock')
  let helperCommand: string | undefined
  let capabilities:unknown
  let deliveryAllowed=()=>true
  const native=async(method:string,params:Record<string,unknown>)=>{
    const checkDelivery=()=>{if(stopping || !deliveryAllowed())throw new JavisError('action_timeout','Caller disconnected or request deadline expired before delivery')}
    checkDelivery()
    if(!nativeSocket || nativeSocket.destroyed){
      await writeFile(tokenPath,token,{mode:0o600})
      const app=process.env.JAVIS_APP_PATH ?? join(homedir(),'Applications/Javis.app')
      helperCommand=`${join(app,'Contents/MacOS/javis-helper')} --agent ${helperSocket} --token-file ${tokenPath} --controller-pid ${process.pid}`
      helper=launchHelperApp(app,helperSocket,tokenPath,process.pid)
      helper.on('error',()=>{});
      const owned=helper
      const started=await validateHelperStartup(
        ()=>waitConnect(helperSocket,10_000),
        async socket=>{
          socket.on('error',()=>{})
          checkDelivery()
          const result=await request(socket,'handshake',{},token)
          if((result as {protocolVersion?:number}).protocolVersion!==1)throw new JavisError('provider_incompatible','Expected helper protocol version 1')
          checkDelivery()
          return result
        },
        async()=>{
          nativeSocket=undefined;capabilities=undefined
          if(helperCommand)await reapHelper(helperCommand)
          owned.kill();setTimeout(()=>owned.kill('SIGKILL'),1000).unref()
          if(helper===owned)helper=undefined
        }
      )
      nativeSocket=started.socket;capabilities=started.result
      await rm(tokenPath,{force:true})
    }
    checkDelivery()
    return method==='handshake'?capabilities:request(nativeSocket,method,params,token)
  }
  const runtime=new SessionRuntime(native)
  const queue=new DeliveryQueue()
  let active=0
  const clients=new Set<net.Socket>()
  const server=net.createServer(socket=>{
    clients.add(socket);socket.on('error',()=>{});socket.on('close',()=>clients.delete(socket))
    const decoder=new JsonLineDecoder()
    let received=false, disconnected=false
    socket.once('end',()=>{disconnected=true})
    socket.on('data',chunk=>{
      if(received || stopping){socket.destroy();return}
      let lines:string[]
      try {lines=decoder.push(chunk)} catch {socket.destroy();return}
      if(!lines.length)return
      received=true
      const line=lines[0], deadline=Date.now()+60_000
      let input: {id:number;method:JavisMethod|'__shutdown';params?:Record<string,unknown>}
      try {input=JSON.parse(line)} catch {socket.destroy();return}
      if(input.method==='__shutdown'){void shutdown(socket,input.id);return}
      active++;clearTimeout(idle)
      void queue.enqueue(()=>!disconnected && !socket.destroyed,deadline,async()=>{
        deliveryAllowed=()=>!disconnected && !socket.destroyed && Date.now()<deadline
        let reply
        try { const result=await runtime.call(input.method as JavisMethod,input.params ?? {});reply={id:input.id,ok:true,result} }
        catch(error){reply={id:input.id,ok:false,error:{code:error instanceof JavisError?error.code:'internal_error',message:error instanceof Error?error.message:String(error)}}}
        if(!socket.destroyed)socket.end(JSON.stringify(reply)+'\n')
      }).finally(()=>{active--;if(!active && !stopping)idle=setTimeout(()=>{void shutdown()},300_000)})
    })
  })
  let stopping: Promise<void> | undefined
  const shutdown = (replySocket?: net.Socket, id = 1): Promise<void> => {
    stopping ??= (async () => {
      clearTimeout(idle)
      queue.stop()
      nativeSocket?.destroy()
      if(helperCommand)await reapHelper(helperCommand)
      if (helper && helper.exitCode === null && helper.signalCode === null) {
        const owned = helper
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => owned.kill('SIGKILL'), 1000)
          owned.once('exit', () => { clearTimeout(timer); resolve() })
          owned.kill()
        })
      }
      await rm(nativeDirectory,{recursive:true,force:true})
      await rm(socketPath,{force:true})
      await rm(lockPath,{recursive:true,force:true})
      if (replySocket && !replySocket.destroyed) await new Promise<void>(resolve => replySocket.end(JSON.stringify({id,ok:true,result:{stopped:true}})+'\n',resolve))
      for (const client of clients) client.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    })()
    return stopping
  }
  let idle=setTimeout(() => { void shutdown() },300_000)
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve)})
  await chmod(socketPath,0o600)
  const onSignal = () => { void shutdown() }
  process.once('SIGTERM',onSignal);process.once('SIGINT',onSignal)
  await new Promise<void>(resolve=>server.once('close',resolve))
  process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal)
}
