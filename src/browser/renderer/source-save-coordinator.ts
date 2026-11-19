export type SourceSavePorts = { signature(): Promise<string>; commit(text: string): Promise<string>; committed(text: string, signature: string): void }
type Request = { text: string; resolve(): void; reject(error: unknown): void }
export class SourceSaveCoordinator {
  private baseline: string | null = null
  private pending: Request[] = []
  private running = false
  constructor(private readonly ports: SourceSavePorts) {}
  get busy():boolean {return this.running || this.pending.length>0}
  setBaseline(signature: string): void { this.baseline = signature }
  save(text: string): Promise<void> {
    return new Promise((resolve,reject) => { this.pending.push({text,resolve,reject}); void this.drain() })
  }
  private async drain(): Promise<void> {
    if(this.running)return
    this.running=true
    try {
      while(this.pending.length) {
        const request=this.pending.shift()!
        try {
          if(this.baseline===null || this.baseline!==await this.ports.signature())throw new Error('The file changed on its host. Reload before saving.')
          const signature=await this.ports.commit(request.text)
          this.baseline=signature
          this.ports.committed(request.text,signature)
          request.resolve()
        } catch(error) { request.reject(error); for(const queued of this.pending.splice(0))queued.reject(error); break }
      }
    } finally { this.running=false }
  }
}
