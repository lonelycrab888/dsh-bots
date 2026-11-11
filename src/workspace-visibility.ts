import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
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
const snapshotSchema=z.object({hidden:z.boolean(),title:z.string(),sessions:z.array(z.string()),visible:z.array(z.string()),pinned:z.array(z.string()),before:z.string().optional()})
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
  async show(path:string,mainSession:string){
    const file=this.file(path),prior=existsSync(file)?snapshotSchema.parse(JSON.parse(readFileSync(file,'utf8'))):undefined
    let workspace=this.registry.list().find(w=>w.path===realpathSync(path))
    workspace??=await this.registry.create(path,prior?.title)
    if(prior?.hidden){
      for(const id of prior.sessions)await workspace.attachSession(id)
      for(let i=prior.sessions.length-1;i>=0;i--)await workspace.insertSessionBefore(prior.sessions[i],prior.sessions[i+1])
      for(const id of prior.visible)await this.registry.unarchiveSession(id)
      for(const id of [...prior.pinned].reverse())await this.registry.pinSession(id)
      await this.registry.insertBefore(workspace.id,this.registry.list().some(w=>w.id===prior.before)?prior.before:undefined)
      this.write(file,{...prior,hidden:false})
    }
    if(!workspace.sessionIds.includes(mainSession))await workspace.attachSession(mainSession)
  }
  async hide(path:string){
    const all=this.registry.list(),index=all.findIndex(w=>w.path===realpathSync(path));if(index<0)return
    const workspace=all[index],file=this.file(path)
    const prior=existsSync(file)?snapshotSchema.parse(JSON.parse(readFileSync(file,'utf8'))):undefined
    // Keep the original visibility snapshot if an earlier cleanup was interrupted.
    const snapshot=prior?.hidden?prior:{hidden:true,title:workspace.title,sessions:[...workspace.sessionIds],visible:workspace.sessionIds.filter(id=>!this.registry.archivedSessionIds.includes(id)),pinned:this.registry.pinnedSessionIds.filter(id=>workspace.sessionIds.includes(id)),before:all[index+1]?.id}
    this.write(file,snapshot)
    for(const id of snapshot.visible)await this.registry.archiveSession(id,{stopActivity:true})
    await this.registry.delete(workspace.id)
  }
}
