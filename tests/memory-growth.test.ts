import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zstdCompressSync } from 'node:zlib'
import { readGroupLog } from '../src/group-log.ts'
import { projection } from '../src/projection.ts'
import { groupPage, groupWindow, taskSummary } from '../src/group-pages.ts'
import { prepareContext, compactCheckpoint } from '../src/group-context.ts'
import { reasoningPreviewLimit, rowUpdate } from '../src/memory-limits.ts'
import { searchTokens } from '../src/workspace-memory.ts'
import { findTask, newTask } from '../src/tasks.ts'
import { SharedGroupMemory } from '../src/shared-memory.ts'
import type { Group, Row } from '../src/bots.ts'
import type { SessionHeader, SessionEvent } from '@deepseek-ai/dsh-session'

const header={type:'session',version:4,id:'memory-test',createdAt:'2026-11-14T00:00:00Z',isSeeded:false,delegationDepth:0} as unknown as SessionHeader
const event=(type:string,data:unknown,seq=0)=>({type,data,seq,time:'2026-11-14T00:00:00Z',ignorable:true}) as SessionEvent
const member={id:'a',name:'A',duty:'test',sessionId:'a-session'}

test('streamed v4 replay preserves latest rows, delta reasoning and title without retaining old snapshots',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-stream-'))
  try {
    const records=[header,event('plugin:dsh-bots/members',[member],0),event('plugin:dsh-bots/rows',[{id:'r',author:'bot',botId:'a',status:'working',text:'',reasoning:'先'}],1),
      event('plugin:dsh-bots/reasoning',{id:'r',offset:1,text:'思考'},2),event('plugin:dsh-bots/rows',[{id:'r',author:'bot',botId:'a',status:'done',text:'最终答案'}],3),event('session/title',{title:'测试群'},4)]
    const text=records.map(x=>JSON.stringify(x)+'\n').join('')
    for(const compressed of [false,true]) {
      const path=join(root,compressed?'session.v4.jsonl.zstd':'session.v4.jsonl')
      writeFileSync(path,compressed?zstdCompressSync(text):text+'{"type":')
      const result=await readGroupLog(path,header,new AbortController().signal)
      assert.equal(result.title,'测试群');assert.equal(result.group?.rows.length,1)
      assert.equal(result.group?.rows[0].text,'最终答案')
      assert.equal((result.group?.rows[0] as {reasoning:string}).reasoning,'先思考')
    }
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('streamed reader rejects corrupt sequences and observes cancellation',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-stream-'))
  try {
    const path=join(root,'session.v4.jsonl')
    writeFileSync(path,JSON.stringify(header)+'\n'+JSON.stringify(event('plugin:dsh-bots/members',[member],5))+'\n')
    await assert.rejects(readGroupLog(path,header,new AbortController().signal),/序列/)
    const controller=new AbortController();controller.abort()
    await assert.rejects(readGroupLog(path,header,controller.signal),/abort/i)
    const seeded={...header,isSeeded:true}
    const inherited=[seeded,event('plugin:dsh-bots/members',[member],0),event('plugin:dsh-bots/rows',[{id:'parent-row',author:'user',text:'do not inherit'}],1),event('session/end-seed',{inherited:true},2),event('plugin:dsh-bots/members',[member],3),event('plugin:dsh-bots/rows',[{id:'own-row',author:'user',text:'own history'}],4)]
    writeFileSync(path,inherited.map(row=>JSON.stringify(row)+'\n').join(''))
    assert.deepEqual((await readGroupLog(path,seeded,new AbortController().signal)).group?.rows.map(row=>row.id),['own-row'])
    writeFileSync(path,inherited.slice(0,3).map(row=>JSON.stringify(row)+'\n').join(''))
    await assert.rejects(readGroupLog(path,seeded,new AbortController().signal),/继承边界/)
    const {HistoryReadGuard}=await import('../src/history-read-guard.ts')
    const guard=new HistoryReadGuard(()=>{})
    assert.equal(await guard.read('broken','r1',new AbortController().signal,()=>readGroupLog(path,seeded,new AbortController().signal)),undefined)
    assert.equal(guard.incomplete,true)
    assert.equal(await guard.read('current','r1',new AbortController().signal,async()=>'normal Agent reply'),'normal Agent reply')
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('wire and historical pages are bounded, exhaustive and preserve attachments',()=>{
  const rows:Row[]=Array.from({length:1200},(_,i)=>({id:'r'+i,author:'user',text:'message '+i}))
  const group:Group={members:[],rows}
  const window=groupWindow(group)!
  assert.equal(window.rows.length,80);assert.equal(window.totalRows,1200);assert.equal(group.rows.length,1200)
  let page=groupPage(rows),ids=page.rows.map(row=>row.id)
  while(page.hasMore){page=groupPage(rows,{before:page.rows[0].id});ids=[...page.rows.map(row=>row.id),...ids]}
  assert.deepEqual(ids,rows.map(row=>row.id))
  assert(groupPage(rows,{around:'r17'}).rows.some(row=>row.id==='r17'))
  assert.throws(()=>groupPage(rows,{before:'absent'}),/找不到/)
  const task=newTask('old-task','旧议题')
  task.attempts.push({rowId:'old-result',botId:'a',name:'A',question:'初稿'})
  group.tasks=[task]
  group.rows.unshift({id:'old-result',author:'bot',botId:'a',status:'done',text:'旧汇总',taskId:task.id,resultKind:'final'})
  const summary=taskSummary(group,task.id)
  assert.equal(summary.completedCount,1)
  assert.equal(summary.result?.text,'旧汇总')
  assert(!groupWindow(group)!.rows.some(row=>row.id==='old-result'))
})

test('reasoning projection bounds old snapshots and ignores repeated deltas',()=>{
  let state=projection.init(header,0 as never)
  state=projection.apply(state,event('plugin:dsh-bots/members',[member]))
  state=projection.apply(state,event('plugin:dsh-bots/rows',[{id:'r',author:'bot',botId:'a',status:'working',text:'',reasoning:'a'}]))
  state=projection.apply(state,event('plugin:dsh-bots/reasoning',{id:'r',offset:1,text:'b'}))
  state=projection.apply(state,event('plugin:dsh-bots/reasoning',{id:'r',offset:1,text:'b'}))
  assert.equal((state.group!.rows[0] as {reasoning:string}).reasoning,'ab')
  const previous=state.group!.rows[0] as Extract<Row,{author:'bot'}>
  const update=rowUpdate({...previous,status:'done',text:'Final answer'},previous)
  assert.deepEqual(update,JSON.parse(JSON.stringify(update)),'host records must be lossless JSON')
  assert(!('reasoning' in update),'status update must not repeat the full preview')
  state=projection.apply(state,event('plugin:dsh-bots/rows',[update]))
  assert.equal(state.group!.rows[0].text,'Final answer')
  assert.equal((state.group!.rows[0] as {reasoning:string}).reasoning,'ab')
  state=projection.apply(state,event('plugin:dsh-bots/rows',[{id:'r',author:'bot',botId:'a',status:'done',text:'final',reasoning:'x'.repeat(200000)}]))
  assert((state.group!.rows[0] as {reasoning:string}).reasoning.length<reasoningPreviewLimit+100)
})

test('long histories keep bounded checkpoints while exact early messages remain retrievable',()=>{
  const rows:Row[]=Array.from({length:6000},(_,i)=>({id:'r'+i,author:'user',text:`历史 ${i} 条，预算 ${i}.45，不得修改原文件。`}))
  const prepared=prepareContext(rows,'a','task','预算')
  assert(prepared.checkpoint.segments.length<=64)
  assert(JSON.stringify(prepared.checkpoint).length<180000)
  assert.equal(rows[0].text,'历史 0 条，预算 0.45，不得修改原文件。')
  const bounded=compactCheckpoint({...prepared.checkpoint,segments:Array(1000).fill(prepared.checkpoint.segments[0])}) as typeof prepared.checkpoint
  assert.equal(bounded.segments.length,64)
  assert(searchTokens(Array.from({length:20000},(_,i)=>'unique'+i).join(' ')).length<=256)
  const task=newTask('long-task','中文资料'.repeat(25000)+'项目预算')
  assert.equal(findTask({members:[],rows:[],tasks:[task]},'继续项目预算',true),task)
})

test('SQLite recall indexes long tails, pages Unicode originals and persists import revisions',()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-recall-'))
  let store=new SharedGroupMemory(root)
  try{
    const text='😀中文 '.repeat(10000)+' TAIL-CANARY-912'
    store.sync('g','Group',{members:[],rows:[{id:'r',author:'user',text}]})
    assert.equal(store.read(0,{query:'TAIL-CANARY-912'}).messages.length,1)
    let offset=0,restored=''
    while(true){const row=store.read(0,{groupId:'g',messageId:'r',offset}).messages[0];restored+=row.text;if(row.nextOffset===undefined)break;offset=row.nextOffset}
    assert.equal(restored,text)
    store.markImported('g','rev1');store.close();store=new SharedGroupMemory(root)
    assert(store.imported('g','rev1'));assert(!store.imported('g','rev2'))
  }finally{store.close();rmSync(root,{recursive:true,force:true})}
})

test('nested forks discard all ancestor projections at the final inherited boundary',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-fork-'))
  const seeded={...header,isSeeded:true}
  try {
    const records=[seeded,event('session/end-seed',{inherited:true},0),event('plugin:dsh-bots/members',[member],1),
      event('plugin:dsh-bots/rows',[{id:'ancestor',author:'user',text:'ancestor private context'}],2),
      event('session/title',{title:'ancestor title'},3),event('session/end-seed',{inherited:true},4),
      event('plugin:dsh-bots/members',[member],5),event('plugin:dsh-bots/rows',[{id:'own',author:'user',text:'own public context'}],6)]
    for(const compressed of [false,true]) {
      const path=join(root,compressed?'session.v4.jsonl.zstd':'session.v4.jsonl')
      const text=records.map(row=>JSON.stringify(row)+'\n').join('')
      writeFileSync(path,compressed?zstdCompressSync(text):text)
      const result=await readGroupLog(path,seeded,new AbortController().signal)
      assert.deepEqual(result.group?.rows.map(row=>row.id),['own'])
      assert.equal(result.title,undefined)
    }
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('bad historical sources do not block reset-era conversations, retry on change, and never swallow cancellation',async()=>{
  const {HistoryReadGuard}=await import('../src/history-read-guard.ts')
  let now=0,reads=0
  const warnings:string[]=[]
  const guard=new HistoryReadGuard(id=>warnings.push(id),()=>now)
  const signal=new AbortController().signal
  const broken=async()=>{reads++;throw new Error('群聊日志缺少继承边界。')}
  assert.equal(await guard.read('old','r1',signal,broken),undefined)
  assert.equal(await guard.read('old','r1',signal,broken),undefined)
  assert.equal(reads,1)
  assert.equal(await guard.read('healthy','r1',signal,async()=>'current group'),'current group')
  assert.equal(guard.incomplete,true)
  assert.equal(await guard.read('old','r2',signal,async()=>'repaired group'),'repaired group')
  assert.equal(guard.incomplete,false)
  await guard.read('old','r3',signal,broken)
  now=30_001
  assert.equal(await guard.read('old','r3',signal,async()=>'flushed'),'flushed')
  const cancel=new AbortController()
  await assert.rejects(guard.read('cancel','r1',cancel.signal,async()=>{cancel.abort();throw cancel.signal.reason}),/abort/i)
  assert.equal(guard.incomplete,false)
  assert.deepEqual(warnings,['old','old'])
})
