import { StringDecoder } from 'node:string_decoder'
import { JavisError } from './error.js'
export class JsonLineDecoder {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  push(chunk: Buffer): string[] {
    this.pending += this.decoder.write(chunk)
    if (this.pending.length > 32 * 1024 * 1024) throw new JavisError('invalid_argument','Request exceeds maximum size')
    const lines=this.pending.split('\n')
    this.pending=lines.pop()!
    return lines
  }
}
export class DeliveryQueue {
  private serial: Promise<void> = Promise.resolve()
  private stopped = false
  stop(): void { this.stopped=true }
  enqueue(connected:()=>boolean, deadline:number, deliver:()=>Promise<void>):Promise<void> {
    const work=this.serial.catch(()=>{}).then(async()=>{
      if (this.stopped || !connected() || Date.now() >= deadline) return
      await deliver()
    })
    this.serial=work
    return work
  }
}
