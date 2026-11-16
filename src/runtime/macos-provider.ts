import net from 'node:net'
import { type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ComputerProviderCapabilities } from '../contract/computer-use-runtime-types.js'
import { JavisError } from './error.js'
import { launchHelperApp } from './helper-launch.js'
import { reapHelper } from './helper-reaping.js'
import type { JavisProvider } from './provider.js'
import { JsonLineDecoder } from './transport.js'

type Options = { stateDirectory?: string; requestTimeoutMs?: number; canDeliver?: () => boolean }
type Generation = {
  directory: string
  socketPath: string
  token: string
  socket: net.Socket
  helper: ChildProcess
  helperCommand: string
  capabilities: ComputerProviderCapabilities
  closing?: Promise<void>
}

function connect(path: string): Promise<net.Socket> {
  return new Promise((resolveConnection,reject)=>{
    const socket=net.createConnection(path)
    socket.once('connect',()=>{socket.off('error',reject);resolveConnection(socket)})
    socket.once('error',reject)
  })
}

async function waitConnect(path: string, deadline: number): Promise<net.Socket> {
  while(true){
    try{return await connect(path)}catch(error){
      if(Date.now()>=deadline)throw new JavisError('startup_timeout','Javis helper did not open its private socket')
      await new Promise(resolve=>setTimeout(resolve,50))
    }
  }
}

function request(socket: net.Socket, id: number, method: string, params: Record<string,unknown>, token: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolveRequest,reject)=>{
    const decoder=new JsonLineDecoder()
    let settled=false
    const cleanup=()=>{clearTimeout(timer);socket.off('data',data);socket.off('close',closed);socket.off('error',failed)}
    const finish=(error?:Error,result?:unknown)=>{
      if(settled)return
      settled=true;cleanup()
      if(error)reject(error);else resolveRequest(result)
    }
    const failed=(error:Error)=>finish(error instanceof JavisError?error:new JavisError('transport_error',error.message))
    const closed=()=>failed(new Error('Helper connection closed; action delivery may be uncertain'))
    const data=(chunk:Buffer)=>{
      let lines:string[]
      try{lines=decoder.push(chunk)}catch(error){failed(error as Error);return}
      if(!lines.length)return
      try{
        const reply=JSON.parse(lines[0]) as {id?:number;ok?:boolean;result?:unknown;error?:{code?:string;message?:string}}
        if(reply.id!==id)throw new JavisError('transport_error','Mismatched helper response ID')
        if(reply.ok===true)finish(undefined,reply.result)
        else finish(new JavisError(reply.error?.code??'transport_error',reply.error?.message??'Helper request failed'))
      }catch(error){failed(error as Error)}
    }
    const timer=setTimeout(()=>{
      finish(new JavisError('action_timeout','Request timed out; action delivery may be uncertain'))
      socket.destroy()
    },timeoutMs)
    socket.on('data',data);socket.once('close',closed);socket.once('error',failed)
    socket.write(JSON.stringify({id,method,params,token})+'\n',error=>{if(error)failed(error)})
  })
}

function requiredCapability(method:string, capabilities:ComputerProviderCapabilities): boolean {
  const supports=capabilities.supports
  if(method==='listApps')return supports.apps?.list===true
  if(method==='listWindows')return supports.windows?.list===true
  const actionKey:Record<string,keyof ComputerProviderCapabilities['supports']['actions']>={
    click:'click',performSecondaryAction:'performAction',scroll:'scroll',drag:'drag',typeText:'typeText',pressKey:'pressKey',hotkey:'hotkey',pasteText:'pasteText',setValue:'setValue'
  }
  const key=actionKey[method]
  return key===undefined || supports.actions?.[key]===true
}

export function createMacOSProvider(options:Options={}):JavisProvider {
  const stateDirectory=options.stateDirectory??join(homedir(),'Library/Application Support/Javis')
  const timeoutMs=options.requestTimeoutMs??60_000
  const canDeliver=options.canDeliver??(()=>true)
  let generation:Generation|undefined
  let nextId=1
  let serial:Promise<unknown>=Promise.resolve()
  let stopped=false

  function checkDelivery():void {
    if(stopped || !canDeliver())throw new JavisError('action_timeout','Caller disconnected or request deadline expired before delivery')
  }

  async function closeGeneration(current:Generation):Promise<void> {
    if(current.closing)return current.closing
    if(generation===current)generation=undefined
    current.closing=(async()=>{
      current.socket.destroy()
      try{await reapHelper(current.helperCommand)}finally{
        if(current.helper.exitCode===null && current.helper.signalCode===null){
          await new Promise<void>(resolveExit=>{
            const timer=setTimeout(()=>{current.helper.kill('SIGKILL');resolveExit()},1000)
            current.helper.once('exit',()=>{clearTimeout(timer);resolveExit()})
            current.helper.kill()
          })
        }
        await rm(current.directory,{recursive:true,force:true})
      }
    })()
    return current.closing
  }

  async function startGeneration():Promise<Generation> {
    checkDelivery()
    const app=resolve(process.env.JAVIS_APP_PATH??join(homedir(),'Applications/Javis.app'))
    const executable=join(app,'Contents/MacOS/javis-helper')
    try{await access(executable,constants.X_OK)}catch{throw new JavisError('provider_unavailable',`Javis helper is missing or not executable at ${executable}; build or install Javis.app`)}
    await mkdir(stateDirectory,{recursive:true,mode:0o700})
    const info=await stat(stateDirectory)
    if(info.uid!==process.getuid?.())throw new JavisError('access_denied','Javis state directory must be owned by the current user')
    await chmod(stateDirectory,0o700)
    const directory=await mkdtemp(join(stateDirectory,'helper-'))
    await chmod(directory,0o700)
    const socketPath=join(directory,'helper.sock')
    const tokenPath=join(directory,'token')
    const token=randomUUID()
    const helperCommand=`${executable} --agent ${socketPath} --token-file ${tokenPath} --controller-pid ${process.pid}`
    let socket:net.Socket|undefined
    let helper:ChildProcess|undefined
    try{
      await writeFile(tokenPath,token,{mode:0o600})
      checkDelivery()
      helper=launchHelperApp(app,socketPath,tokenPath,process.pid)
      helper.on('error',()=>{})
      socket=await waitConnect(socketPath,Date.now()+10_000)
      socket.on('error',()=>{})
      checkDelivery()
      const capabilities=await request(socket,nextId++,'handshake',{},token,timeoutMs) as ComputerProviderCapabilities
      if(capabilities?.protocolVersion!==1 || !capabilities.supports)throw new JavisError('provider_incompatible','Expected helper protocol version 1 and capability flags')
      checkDelivery()
      await rm(tokenPath,{force:true})
      const current:Generation={directory,socketPath,token,socket,helper,helperCommand,capabilities}
      generation=current
      socket.once('close',()=>{if(generation===current)void closeGeneration(current).catch(()=>{})})
      return current
    }catch(error){
      socket?.destroy()
      try{if(helper)await reapHelper(helperCommand)}finally{
        helper?.kill()
        await rm(directory,{recursive:true,force:true})
      }
      throw error
    }
  }

  async function execute(method:string,params:Record<string,unknown>):Promise<unknown> {
    checkDelivery()
    if(generation?.socket.destroyed)await closeGeneration(generation)
    const current=generation??await startGeneration()
    checkDelivery()
    if(method==='handshake')return current.capabilities
    if(!requiredCapability(method,current.capabilities))throw new JavisError('unsupported_capability',`The Javis macOS helper does not support ${method}`)
    try{return await request(current.socket,nextId++,method,params,current.token,timeoutMs)}
    catch(error){await closeGeneration(current).catch(()=>{});throw error}
  }

  return {
    call(method,params){
      const pending=serial.catch(()=>{}).then(()=>execute(method,params))
      serial=pending
      return pending
    },
    async shutdown(){
      stopped=true
      if(generation)await closeGeneration(generation)
      await serial.catch(()=>{})
    }
  }
}
