import net from 'node:net'
import { EventEmitter, once } from 'node:events'
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks=vi.hoisted(()=>({launch:vi.fn(),reap:vi.fn(async()=>{})}))
vi.mock('../../src/runtime/helper-launch.js',()=>({launchHelperApp:mocks.launch}))
vi.mock('../../src/runtime/helper-reaping.js',()=>({reapHelper:mocks.reap}))
import { createMacOSProvider } from '../../src/runtime/macos-provider.js'

const capabilities={
 platform:'darwin',provider:'javis',providerVersion:'1',protocolVersion:1,
 supports:{apps:{list:true,bundleIds:true,pids:true},windows:{list:true,targetById:true,targetByIndex:true,focus:false,moveResize:false},observation:{screenshot:true,annotatedScreenshot:false,elementFrames:true,ocr:false},actions:{click:true,typeText:true,pressKey:true,hotkey:true,pasteText:true,scroll:true,drag:true,setValue:true,performAction:true},surfaces:{menus:false,dialogs:false,dock:false,menubar:false}}
}
let stateDirectory:string
let appPath:string
const servers:net.Server[]=[]
const peers=new Set<net.Socket>()
const launches:{socketPath:string;token:string;methods:string[]}[]=[]
let replyMode:'normal'|'close'|'hang'='normal'
let handshake=capabilities

beforeEach(async()=>{
 stateDirectory=await mkdtemp(join(tmpdir(),'javis-mac-provider-test-'))
 appPath=join(stateDirectory,'Javis.app')
 const executable=join(appPath,'Contents/MacOS/javis-helper')
 await mkdir(join(appPath,'Contents/MacOS'),{recursive:true})
 await writeFile(executable,'')
 await chmod(executable,0o700)
 vi.stubEnv('JAVIS_APP_PATH',appPath)
 launches.length=0
 replyMode='normal'
 handshake=capabilities
 mocks.launch.mockImplementation((_:string,socketPath:string,tokenPath:string)=>{
  const child=new EventEmitter() as EventEmitter & {kill:(signal?:string)=>boolean;exitCode:number|null;signalCode:string|null}
  child.exitCode=null;child.signalCode=null
  const server=net.createServer(socket=>{
   peers.add(socket)
   socket.on('close',()=>peers.delete(socket))
   let pending=''
   socket.on('data',chunk=>{
    pending+=chunk.toString()
    let boundary=pending.indexOf('\n')
    while(boundary>=0){
     const request=JSON.parse(pending.slice(0,boundary)) as {id:number;method:string;token:string}
     pending=pending.slice(boundary+1)
     const launched=launches.find(item=>item.socketPath===socketPath)!
     launched.methods.push(request.method)
     if(request.token!==launched.token){socket.end(JSON.stringify({id:request.id,ok:false,error:{code:'access_denied',message:'Bad token'}})+'\n');return}
     if(request.method==='handshake')socket.write(JSON.stringify({id:request.id,ok:true,result:handshake})+'\n')
     else if(replyMode==='close'){socket.end(JSON.stringify({id:request.id,ok:true,result:{apps:[]}})+'\n')}
     else if(replyMode!=='hang')socket.write(JSON.stringify({id:request.id,ok:true,result:{apps:[]}})+'\n')
     boundary=pending.indexOf('\n')
    }
   })
  })
  servers.push(server)
  void readFile(tokenPath,'utf8').then(token=>{launches.push({socketPath,token,methods:[]});server.listen(socketPath)})
  child.kill=(signal)=>{child.exitCode=0;child.signalCode=signal??null;child.emit('exit',0,signal);server.close();return true}
  return child
 })
 mocks.reap.mockClear()
})

afterEach(async()=>{
 for(const peer of peers)peer.destroy()
 await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))))
 await rm(stateDirectory,{recursive:true,force:true})
 vi.unstubAllEnvs()
 mocks.launch.mockReset()
})

it('rotates the socket and token after a helper disconnect and removes the old generation',async()=>{
 const provider=createMacOSProvider({stateDirectory,requestTimeoutMs:200})
 try{
  await provider.call('handshake',{})
  replyMode='close'
  const closed=once([...peers][0],'close')
  await provider.call('listApps',{})
  await closed
  replyMode='normal'
  await provider.call('listApps',{})
  expect(launches).toHaveLength(2)
  expect(launches[1].socketPath).not.toBe(launches[0].socketPath)
  expect(launches[1].token).not.toBe(launches[0].token)
  await expect(access(join(launches[0].socketPath,'..'))).rejects.toThrow()
  expect(mocks.reap).toHaveBeenCalled()
 }finally{await provider.shutdown()}
})

it('reaps a timed-out helper before starting another generation',async()=>{
 const provider=createMacOSProvider({stateDirectory,requestTimeoutMs:30})
 try{
  await provider.call('handshake',{})
  replyMode='hang'
  await expect(provider.call('listApps',{})).rejects.toMatchObject({code:'action_timeout'})
  expect(mocks.reap).toHaveBeenCalledTimes(1)
  replyMode='normal'
  await provider.call('listApps',{})
  expect(launches).toHaveLength(2)
 }finally{await provider.shutdown()}
})

it('closes an in-flight helper request promptly on shutdown',async()=>{
 const provider=createMacOSProvider({stateDirectory,requestTimeoutMs:1000})
 await provider.call('handshake',{})
 replyMode='hang'
 const pending=provider.call('listApps',{})
 const rejection=expect(pending).rejects.toMatchObject({code:'transport_error'})
 await new Promise(resolve=>setTimeout(resolve,20))
 await Promise.race([provider.shutdown(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Shutdown waited for request timeout')),200))])
 await rejection
 expect(mocks.reap).toHaveBeenCalledTimes(1)
})

it('rejects unsupported native methods before delivery',async()=>{
 handshake={...capabilities,supports:{...capabilities.supports,windows:{...capabilities.supports.windows,list:false},actions:{...capabilities.supports.actions,click:false}}}
 const provider=createMacOSProvider({stateDirectory,requestTimeoutMs:200})
 try{
  await expect(provider.call('listWindows',{app:'Finder'})).rejects.toMatchObject({code:'unsupported_capability'})
  await expect(provider.call('click',{app:'Finder',elementIndex:0})).rejects.toMatchObject({code:'unsupported_capability'})
  expect(launches[0].methods).toEqual(['handshake'])
 }finally{await provider.shutdown()}
})

it('fails preflight before attempting LaunchServices when the app executable is missing',async()=>{
 vi.stubEnv('JAVIS_APP_PATH',join(stateDirectory,'missing.app'))
 const provider=createMacOSProvider({stateDirectory,requestTimeoutMs:200})
 try{
  await expect(provider.call('handshake',{})).rejects.toMatchObject({code:'provider_unavailable'})
  expect(mocks.launch).not.toHaveBeenCalled()
 }finally{await provider.shutdown()}
})
