import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performReset,finishReset,sessionIsCurrent,type ResetPort,type ResetState} from '../src/reset.ts'
import {fixtureLibrary} from './fixtures.ts'
import {defaultMemory} from '../src/memory.ts'
import {WorkspaceMemory} from '../src/workspace-memory.ts'
import {freshCoordinator} from '../src/bots.ts'
function fixture(){
 let state:ResetState={library:structuredClone(fixtureLibrary),kingMemory:{...defaultMemory,entries:[{id:'legacy',text:'偏好参考 architect',source:'manual',archived:false,updatedAt:new Date().toISOString()}]},kingWorkspace:{path:'/test/Bots',sessionId:'king',legacyImported:true},resetEpoch:0,sessionEpoch:0,resetPending:null}
 let revision=4,cleared=0,forgotten=0,conversations=0
 const port:ResetPort={read:()=>({state,revision}),commit:async(patch,expected)=>{assert.equal(expected,revision);state={...state,...patch};revision++},clearMemory:async w=>{assert.equal(w?.path,'/test/Bots');cleared++},forgetSessions:async w=>{assert.equal(w?.sessionId,'king');forgotten++},clearConversation:async(w,id)=>{assert.equal(w.sessionId,'king');assert.match(id,/^session-/);conversations++;state={...state,kingWorkspace:{...w,sessionId:id}}}}
 return {port,counts:()=>({cleared,forgotten,conversations})}
}
for(let bits=1;bits<8;bits++)test(`reset selection ${bits} changes only chosen data and retires old identities`,async()=>{
 const {port,counts}=fixture(),before=structuredClone(port.read().state),options={members:!!(bits&1),memory:!!(bits&2),sessions:!!(bits&4)}
 await performReset(port,options,4)
 const after=port.read().state
 assert.deepEqual(after.library.bots,options.members?[]:before.library.bots)
 assert.deepEqual(after.library.deletedBotIds,options.members?['architect','reviewer']:[])
 assert.equal(after.library.maxMembers,before.library.maxMembers)
 assert.equal(after.kingMemory.entries.length,options.memory?0:1)
 if(options.members&&!options.memory)assert(!after.kingMemory.entries[0].text.includes('architect'))
 if(options.memory&&!options.sessions){assert.notEqual(after.kingWorkspace?.sessionId,before.kingWorkspace?.sessionId);assert.equal(after.kingWorkspace?.path,before.kingWorkspace?.path)}else assert.deepEqual(after.kingWorkspace,options.sessions?null:before.kingWorkspace)
 assert.deepEqual(counts(),{cleared:Number(options.memory),forgotten:Number(options.sessions),conversations:Number(options.memory&&!options.sessions)})
 assert.equal(after.sessionEpoch,Number(options.sessions));assert.equal(after.resetPending,null)
 const old=freshCoordinator(undefined,0,3,()=> 'old','/test/Bots')
 const next=freshCoordinator(old,after.resetEpoch+after.library.deletedBotIds.length,8,()=> 'new','/test/Bots')
 assert.equal(next.sessionId,'new');assert.equal(next.historyStart,8)
 assert.equal(sessionIsCurrent({},after.sessionEpoch),!options.sessions)
 assert(sessionIsCurrent({sessionEpoch:after.sessionEpoch},after.sessionEpoch))
})
test('empty selection and stale settings cannot start reset or touch storage',async()=>{
 const {port,counts}=fixture()
 await assert.rejects(performReset(port,{members:false,memory:false,sessions:false},4))
 await assert.rejects(performReset(port,{members:true,memory:true,sessions:true},3))
 assert.equal(port.read().revision,4);assert.deepEqual(counts(),{cleared:0,forgotten:0,conversations:0})
})
test('interrupted reset persists its original choices and workspace and completes on restart',async()=>{
 const {port}=fixture(),original=port.clearMemory
 port.clearMemory=async()=>{throw Error('simulated disk failure')}
 await assert.rejects(performReset(port,{members:false,memory:true,sessions:true},4))
 assert.equal(port.read().state.kingWorkspace,null)
 assert.equal(port.read().state.resetPending?.workspace?.sessionId,'king')
 port.clearMemory=original
 await finishReset(port)
 assert.equal(port.read().state.resetPending,null);assert.equal(port.read().state.resetEpoch,1)
 assert.equal(port.read().state.library.bots.length,2)
})
test('memory reset removes active and archived entries, index and old audit payloads, prevents legacy import and survives restart',()=>{
 const path=mkdtempSync(join(tmpdir(),'dsh-reset-'));let store=new WorkspaceMemory(path)
 try{
  store.edit({text:'secret-active'},store.revision());store.edit({text:'secret-archived',archived:true},store.revision())
  const exported=store.export(),before=store.revision()
  store.reset()
  assert(store.revision()>before);assert.equal(store.list().total,0);assert.equal(store.list('',true).total,0)
  assert.equal(store.recall('secret',defaultMemory).state.entries.length,0)
  assert(!JSON.stringify(store.db.prepare('SELECT * FROM audit').all()).includes('secret-'))
  assert.equal(store.db.prepare('SELECT count(*) n FROM recall').get()?.n,0)
  store.importLegacy({...defaultMemory,entries:[{id:'legacy',text:'legacy-secret',source:'manual',archived:false,updatedAt:new Date().toISOString()}]})
  assert.equal(store.list().total,0);assert.equal(JSON.parse(readFileSync(exported,'utf8')).entries.length,2)
  store.close();store=new WorkspaceMemory(path);assert.equal(store.list().active,0)
 }finally{store.close();rmSync(path,{recursive:true,force:true})}
})

test('memory reset without a selected workspace cannot claim to clear detached files',async()=>{
 const {port}=fixture();await port.commit({kingWorkspace:null},4)
 await assert.rejects(performReset(port,{members:false,memory:true,sessions:false},5),/请选择|请先选择/)
 assert.equal(port.read().revision,5)
})


test('clear page replaces only the conversation and preserves memory, members and group epochs',async()=>{
 const {port,counts}=fixture(),before=structuredClone(port.read().state)
 await performReset(port,{members:false,memory:false,sessions:false,conversation:true},4)
 const after=port.read().state
 assert.deepEqual(after.kingMemory,before.kingMemory)
 assert.deepEqual(after.library,before.library)
 assert.equal(after.sessionEpoch,before.sessionEpoch)
 assert.equal(after.resetEpoch,before.resetEpoch)
 assert.notEqual(after.kingWorkspace?.sessionId,before.kingWorkspace?.sessionId)
 assert.deepEqual(counts(),{cleared:0,forgotten:0,conversations:1})
})

test('memory reset retries the same fresh conversation after an interrupted replacement',async()=>{
 const {port}=fixture(),complete=port.clearConversation
 let id=''
 port.clearConversation=async(_,next)=>{id=next;throw Error('interrupted replacement')}
 await assert.rejects(performReset(port,{members:false,memory:true,sessions:false},4),/interrupted/)
 assert.equal(port.read().state.kingMemory.entries.length,0)
 assert.equal(port.read().state.resetPending?.replacementSessionId,id)
 port.clearConversation=async(workspace,next)=>{assert.equal(next,id);await complete(workspace,next)}
 await finishReset(port)
 assert.equal(port.read().state.kingWorkspace?.sessionId,id)
 assert.equal(port.read().state.resetPending,null)
})


test('legacy pending memory resets also establish a fresh native conversation',async()=>{
 const {port,counts}=fixture()
 await port.commit({resetPending:{options:{members:false,memory:true,sessions:false},workspace:port.read().state.kingWorkspace}},4)
 await finishReset(port)
 assert.equal(counts().conversations,1)
 assert.notEqual(port.read().state.kingWorkspace?.sessionId,'king')
 assert.equal(port.read().state.resetPending,null)
})
