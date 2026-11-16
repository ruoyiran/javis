import { describe, it, expect, vi } from 'vitest'
import { SessionRuntime } from '../../src/runtime/session.js'
describe('session namespace', () => {
  it('creates snapshot sessions and refuses unobserved action sessions', async () => {
    const runtime = new SessionRuntime(async (_method, params) => ({ snapshot: { id:'one', app:{pid:1}, window:{id:1}, treeText:'App\n0 Button\n' }, namespace:params.session }))
    const result = await runtime.call('getAppState', {app:'Finder'}) as any
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.namespace).toBe(result.sessionId)
    await expect(runtime.call('click', {app:'Finder', elementIndex:0, sessionId:'missing'})).rejects.toMatchObject({code:'stale_snapshot'})
  })
})
it('advertises daemon tree diffs while retaining native observation capabilities',async()=>{
 const native={protocolVersion:1,supports:{observation:{screenshot:true,treeDiff:false}}}
 const runtime=new SessionRuntime(async()=>native)
 expect(await runtime.call('capabilities',{})).toEqual({protocolVersion:1,supports:{observation:{screenshot:true,treeDiff:true}}})
 expect(native.supports.observation.treeDiff).toBe(false)
})
it('retains a delivered action when its observation fails',async()=>{
 const delivered: import('../../src/contract/computer-use-runtime-types.js').ComputerActionResult={
  action:{path:'synthetic',delivery:'background',verification:{state:'unverified',reason:'value_mismatch'}},
  observationError:{code:'accessibility_error',message:'Window closed after input'},snapshot:null,screenshot:null
 }
 const runtime=new SessionRuntime(async method=>method==='getAppState'?{snapshot:{id:'one',app:{pid:1},window:{id:1},treeText:'App\n0 Button\n'}}:delivered)
 const snapshot=await runtime.call('getAppState',{app:'Finder'}) as {sessionId:string}
 expect(await runtime.call('click',{app:'Finder',elementIndex:0,sessionId:snapshot.sessionId,treeDiff:true})).toEqual({...delivered,sessionId:snapshot.sessionId})
 await expect(runtime.call('click',{app:'Finder',elementIndex:0,sessionId:snapshot.sessionId})).rejects.toMatchObject({code:'stale_snapshot'})
})

it('binds a session to its observed app and window',async()=>{
 const native=vi.fn(async()=>({snapshot:{id:'one',app:{pid:1},window:{id:42,index:1},treeText:'App\n0 Button\n'},screenshot:null,screenshotStatus:{state:'skipped',reason:'no_screenshot_flag'}}))
 const runtime=new SessionRuntime(native)
 const observed=await runtime.call('getAppState',{app:'Finder',windowId:42}) as {sessionId:string}
 await expect(runtime.call('click',{app:'Notes',elementIndex:0,sessionId:observed.sessionId})).rejects.toMatchObject({code:'stale_snapshot'})
 await expect(runtime.call('click',{app:'Finder',windowId:43,elementIndex:0,sessionId:observed.sessionId})).rejects.toMatchObject({code:'stale_snapshot'})
 expect(native).toHaveBeenCalledTimes(1)
})

it('binds an unselected Linux window by the index returned from observation', async () => {
 const native=vi.fn(async()=>({snapshot:{id:'linux-window',app:{pid:7},window:{id:null,index:2},treeText:'0 window\n1 button'},screenshot:null}))
 const runtime=new SessionRuntime(native)
 const observed=await runtime.call('getAppState',{app:'Fixture'}) as {sessionId:string}
 await expect(runtime.call('click',{app:'Fixture',windowIndex:2,elementIndex:1,sessionId:observed.sessionId})).resolves.toMatchObject({sessionId:observed.sessionId})
 expect(native).toHaveBeenCalledTimes(2)
})

it('invalidates a session after an action times out with uncertain delivery', async () => {
 const tree='App\n'+Array.from({length:20},(_,index)=>`${index} AXButton Item ${index}`).join('\n')
 const native=vi.fn(async method=>{
  if(method==='getAppState')return {snapshot:{id:'one',app:{pid:1},window:{id:42},treeText:tree},screenshot:null}
  throw Object.assign(new Error('delivery uncertain'),{code:'action_timeout'})
 })
 const runtime=new SessionRuntime(native)
 const observed=await runtime.call('getAppState',{app:'Finder'}) as {sessionId:string}
 await expect(runtime.call('click',{app:'Finder',elementIndex:1,sessionId:observed.sessionId})).rejects.toMatchObject({code:'action_timeout'})
 await expect(runtime.call('click',{app:'Finder',elementIndex:1,sessionId:observed.sessionId})).rejects.toMatchObject({code:'stale_snapshot'})
 const refreshed=await runtime.call('getAppState',{app:'Finder',sessionId:observed.sessionId,treeDiff:true}) as {snapshot:{treeDiff?:unknown}}
 expect(refreshed.snapshot.treeDiff).toBeUndefined()
 expect(native).toHaveBeenCalledTimes(3)
})

it('uses a stable worktree context session and rejects mixed targeting',async()=>{
 const native=vi.fn(async (_method, params)=>({snapshot:{id:'one',app:{pid:1},window:{id:42},treeText:'App\n0 Button\n'},screenshot:null,screenshotStatus:{state:'skipped',reason:'no_screenshot_flag'},namespace:params.session}))
 const runtime=new SessionRuntime(native)
 const observed=await runtime.call('getAppState',{app:'Finder',worktree:'/repo/task'}) as {sessionId:string;namespace:string}
 expect(observed.namespace).toBe(observed.sessionId)
 expect((await runtime.call('getAppState',{app:'Finder',worktree:'/repo/task'}) as {sessionId:string}).sessionId).toBe(observed.sessionId)
 expect((await runtime.call('click',{app:'Finder',elementIndex:0,worktree:'/repo/task'}) as {sessionId:string}).sessionId).toBe(observed.sessionId)
 await expect(runtime.call('click',{app:'Finder',elementIndex:0,worktree:'/repo/other'})).rejects.toMatchObject({code:'stale_snapshot'})
 await expect(runtime.call('getAppState',{app:'Finder',worktree:'/repo/task',sessionId:'explicit'})).rejects.toMatchObject({code:'invalid_argument'})
})
