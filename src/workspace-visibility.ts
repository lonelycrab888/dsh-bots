import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

interface Workspace {id:string;path:string;title:string;sessionIds:readonly string[];attachSession(id:string):Promise<void>;insertSessionBefore(id:string,before?:string):Promise<void>}
export interface WorkspaceRegistryPort {
  list():Workspace[];create(path:string,title?:string):Promise<Workspace>;delete(id:string):Promise<boolean>
  archivedSessionIds:readonly string[];pinnedSessionIds:readonly string[]
  archiveSession(id:string,options:{stopActivity:true}):Promise<void>;unarchiveSession(id:string):Promise<void>;pinSession(id:string):Promise<void>
  insertBefore(id:string,before?:string):Promise<unknown>
}
const snapshotSchema=z.object({path:z.string().optional(),hidden:z.boolean(),title:z.string(),sessions:z.array(z.string()),visible:z.array(z.string()),pinned:z.array(z.string()),before:z.string().optional()})
export class WorkspaceVisibility {
  private readonly registry:WorkspaceRegistryPort
  constructor(registry:WorkspaceRegistryPort){this.registry=registry}
  private file(path:string) {
    const root=realpathSync(path),dir=join(root,'.dsh-bots');mkdirSync(dir,{recursive:true,mode:0o700})
    if(realpathSync(dir)!==dir)throw new Error('Bots 状态目录不能是符号链接。')
    const file=join(dir,'sidebar-state.json')
    if(existsSync(file)&&realpathSync(file)!==file)throw new Error('Bots 状态文件不能是符号链接。')
    return file
  }
  private write(file:string,value:z.infer<typeof snapshotSchema>){
    const temp=file+'.tmp-'+randomUUID();writeFileSync(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});renameSync(temp,file)
  }
  async forget(path:string){
    await this.hide(path)
    if(existsSync(path))rmSync(this.file(path),{force:true})
  }
  async show(path:string,mainSession:string,firstSession=mainSession){
    const file=this.file(path),prior=existsSync(file)?snapshotSchema.parse(JSON.parse(readFileSync(file,'utf8'))):undefined
    let workspace=this.registry.list().find(w=>w.path===realpathSync(path))
    workspace??=await this.registry.create(path,prior?.title)
    if(prior?.hidden){
      const restored:string[]=[]
      if(!prior.path||prior.path===realpathSync(path))for(const id of prior.sessions){
        try{await workspace.attachSession(id);restored.push(id)}
        catch(error){
          // A moved/copied folder may contain a snapshot of sessions whose cwd
          // belongs to its old location. Keep that history archived there.
          if(!(error instanceof Error)||!/^cannot attach session .*cwd/.test(error.message))throw error
        }
      }
      for(let i=restored.length-1;i>=0;i--)await workspace.insertSessionBefore(restored[i],restored[i+1])
      for(const id of prior.visible.filter(id=>restored.includes(id)))await this.registry.unarchiveSession(id)
      for(const id of [...prior.pinned].reverse().filter(id=>restored.includes(id)))await this.registry.pinSession(id)
      await this.registry.insertBefore(workspace.id,this.registry.list().some(w=>w.id===prior.before)?prior.before:undefined)
      this.write(file,{...prior,hidden:false})
    }
    if(!workspace.sessionIds.includes(mainSession))await workspace.attachSession(mainSession)
    await this.keepFirst(path,firstSession)
  }
  async keepFirst(path:string,sessionId:string){
    const workspace=this.registry.list().find(item=>item.path===path)
    if(!workspace||!workspace.sessionIds.includes(sessionId)||this.registry.archivedSessionIds.includes(sessionId))return
    if(!this.registry.pinnedSessionIds.includes(sessionId))await this.registry.pinSession(sessionId)
    const first=workspace.sessionIds[0]
    if(first!==sessionId)await workspace.insertSessionBefore(sessionId,first)
  }
  async hide(path:string){
    const canonical=existsSync(path)?realpathSync(path):path
    const all=this.registry.list(),index=all.findIndex(w=>w.path===canonical);if(index<0)return
    if(!existsSync(path)){
      for(const id of all[index].sessionIds)await this.registry.archiveSession(id,{stopActivity:true})
      await this.registry.delete(all[index].id);return
    }
    const workspace=all[index],file=this.file(path)
    const prior=existsSync(file)?snapshotSchema.parse(JSON.parse(readFileSync(file,'utf8'))):undefined
    // Keep the original visibility snapshot if an earlier cleanup was interrupted.
    const snapshot=prior?.hidden?prior:{path:realpathSync(path),hidden:true,title:workspace.title,sessions:[...workspace.sessionIds],visible:workspace.sessionIds.filter(id=>!this.registry.archivedSessionIds.includes(id)),pinned:this.registry.pinnedSessionIds.filter(id=>workspace.sessionIds.includes(id)),before:all[index+1]?.id}
    this.write(file,snapshot)
    for(const id of snapshot.visible)await this.registry.archiveSession(id,{stopActivity:true})
    await this.registry.delete(workspace.id)
  }
}
