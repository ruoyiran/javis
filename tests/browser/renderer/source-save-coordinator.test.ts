import {expect,it} from 'vitest'
import {SourceSaveCoordinator} from '../../../src/browser/renderer/source-save-coordinator'
it('commits queued B after A using the confirmed new disk baseline',async()=>{
 let disk='initial',signature='version-0',release!:()=>void
 const first=new Promise<void>(resolve=>{release=resolve})
 const coordinator=new SourceSaveCoordinator({signature:async()=>signature,commit:async(text)=>{if(text==='A')await first;disk=text;signature=text==='A'?'version-1':'version-2';return signature},committed:()=>{}})
 coordinator.setBaseline('version-0')
 const a=coordinator.save('A'),b=coordinator.save('B');release()
 await Promise.all([a,b])
 expect(disk).toBe('B');expect(signature).toBe('version-2')
})
it('refuses a genuine external write between confirmed A and queued B',async()=>{
 let disk='initial',signature='version-0',release!:()=>void
 const first=new Promise<void>(resolve=>{release=resolve})
 const coordinator=new SourceSaveCoordinator({signature:async()=>signature,commit:async(text)=>{await first;disk=text;signature='version-1';return signature},committed:()=>{disk='external';signature='external-version'}})
 coordinator.setBaseline('version-0')
 const a=coordinator.save('A'),b=coordinator.save('B');const refusal=expect(b).rejects.toThrow('file changed');release();await a;await refusal
 expect(disk).toBe('external')
})
