import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync,readFileSync,realpathSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{WorkspaceVisibility,type WorkspaceRegistryPort}from'../src/workspace-visibility.ts'
test('disable hides only the King registration and sessions; enable restores membership, archive state and pins',async()=>{
 const path=realpathSync(mkdtempSync(join(tmpdir(),'dsh-visibility-')))
 let items:any[]=[];let serial=0
 const make=(p:string,title:string,ids:string[]=[])=>({id:String(++serial),path:p,title,sessionIds:ids,async attachSession(id:string){if(!this.sessionIds.includes(id))this.sessionIds.push(id)},async insertSessionBefore(id:string,before?:string){this.sessionIds=this.sessionIds.filter(x=>x!==id);this.sessionIds.splice(before?this.sessionIds.indexOf(before):this.sessionIds.length,0,id)}})
 items=[make(path,'Bots',['main','already-archived']),make('/other','Other',['unrelated'])]
 const registry:WorkspaceRegistryPort={list:()=>items,create:async(p,t)=>{const w=make(p,t??'Bots');items.unshift(w);return w},delete:async id=>{items=items.filter(w=>w.id!==id);return true},archivedSessionIds:['already-archived'],pinnedSessionIds:['main','unrelated'],async archiveSession(id){this.archivedSessionIds=[...new Set([...this.archivedSessionIds,id])];this.pinnedSessionIds=this.pinnedSessionIds.filter(x=>x!==id)},async unarchiveSession(id){this.archivedSessionIds=this.archivedSessionIds.filter(x=>x!==id)},async pinSession(id){this.pinnedSessionIds=[id,...this.pinnedSessionIds.filter(x=>x!==id)]},async insertBefore(id,before){const item=items.find(w=>w.id===id);items=items.filter(w=>w.id!==id);items.splice(before?items.findIndex(w=>w.id===before):items.length,0,item)}}
 try{
  await new WorkspaceVisibility(registry).hide(path)
  assert.deepEqual(items.map(w=>w.title),['Other']);assert(registry.archivedSessionIds.includes('main'));assert(!registry.archivedSessionIds.includes('unrelated'))
  assert.equal(JSON.parse(readFileSync(join(path,'.dsh-bots/sidebar-state.json'),'utf8')).hidden,true)
  await new WorkspaceVisibility(registry).show(path,'main')
  assert.deepEqual(items.map(w=>w.title),['Bots','Other']);assert.deepEqual(items[0].sessionIds,['main','already-archived'])
  assert.deepEqual(registry.archivedSessionIds,['already-archived']);assert.deepEqual(registry.pinnedSessionIds,['main','unrelated'])
  await new WorkspaceVisibility(registry).hide(path);await new WorkspaceVisibility(registry).hide(path);await new WorkspaceVisibility(registry).show(path,'main')
  assert.deepEqual(registry.archivedSessionIds,['already-archived'])
 }finally{rmSync(path,{recursive:true,force:true})}
})
