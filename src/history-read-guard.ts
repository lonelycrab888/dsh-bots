// A broken or still-being-written historical source must not block an unrelated
// Agent turn. Failures are bounded, retryable and never recorded as imported.
export class HistoryReadGuard {
  private failures = new Map<string, {revision:string;retryAt:number}>()
  private report:(id:string,error:unknown)=>void
  private now:()=>number
  constructor(report:(id:string,error:unknown)=>void, now=Date.now) { this.report=report;this.now=now }
  get incomplete() { return this.failures.size > 0 }
  async read<T>(id:string, revision:string, signal:AbortSignal, read:()=>Promise<T>):Promise<T|undefined> {
    signal.throwIfAborted()
    const previous=this.failures.get(id)
    if(previous?.revision===revision && previous.retryAt>this.now())return undefined
    try {
      const result=await read()
      signal.throwIfAborted()
      this.failures.delete(id)
      return result
    } catch(error) {
      signal.throwIfAborted()
      if(!previous || previous.revision!==revision)this.report(id,error)
      this.failures.delete(id)
      this.failures.set(id,{revision,retryAt:this.now()+30_000})
      if(this.failures.size>128)this.failures.delete(this.failures.keys().next().value!)
      return undefined
    }
  }
}
