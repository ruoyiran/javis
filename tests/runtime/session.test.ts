import { describe, it, expect } from 'vitest'
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
})
