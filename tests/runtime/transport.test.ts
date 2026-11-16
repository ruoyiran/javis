import { it, expect } from 'vitest'
import { JsonLineDecoder, DeliveryQueue } from '../../src/runtime/transport.js'
it('preserves Chinese and emoji when UTF-8 bytes cross reads',()=>{
 const decoder=new JsonLineDecoder(), bytes=Buffer.from('{"text":"中文😀"}\n')
 const lines=Array.from(bytes).flatMap(byte=>decoder.push(Buffer.from([byte])))
 expect(lines).toEqual(['{"text":"中文😀"}'])
})
it('discards disconnected and expired queued deliveries and prevents work after stop',async()=>{
 const queue=new DeliveryQueue(), calls:string[]=[]
 let release!:()=>void, started!:()=>void
 const ready=new Promise<void>(resolve=>{started=resolve})
 const first=queue.enqueue(()=>true,Date.now()+1000,async()=>{await new Promise<void>(resolve=>{release=resolve;started()});calls.push('first')})
 await ready
 const disconnected=queue.enqueue(()=>false,Date.now()+1000,async()=>{calls.push('disconnected')})
 const expired=queue.enqueue(()=>true,0,async()=>{calls.push('expired')})
 queue.stop();release()
 await Promise.all([first,disconnected,expired])
 await queue.enqueue(()=>true,Date.now()+1000,async()=>{calls.push('after stop')})
 expect(calls).toEqual(['first'])
})
it('skips canceled and expired requests while still delivering a valid queued request',async()=>{
 const queue=new DeliveryQueue(), calls:string[]=[]
 await queue.enqueue(()=>false,Date.now()+1000,async()=>{calls.push('canceled')})
 await queue.enqueue(()=>true,0,async()=>{calls.push('expired')})
 await queue.enqueue(()=>true,Date.now()+1000,async()=>{calls.push('valid')})
 expect(calls).toEqual(['valid'])
})
