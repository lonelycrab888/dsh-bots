import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceMemory, searchTokens } from '../src/workspace-memory.ts'
import { defaultMemory } from '../src/memory.ts'
import { createRequestedBots, defaultLibrary } from '../src/bots.ts'

function temp() { return mkdtempSync(join(tmpdir(),'dsh-king-test-')) }
test('workspace SQLite stores over 32 memories, searches Chinese/English and survives reopening', () => {
  const path=temp();let store=new WorkspaceMemory(path)
  try {
    store.edit({text:'火星探测项目的暗号是 ORBIT-913',pinned:false},store.revision())
    for(let i=0;i<80;i++)store.edit({text:`其他偏好记录 ${i}`},store.revision())
    assert.equal(store.list().active,81)
    assert.equal(store.list('',false,50).entries.length,31)
    const memory=store.recall('火星探测的暗号是什么',defaultMemory).state
    assert(memory.entries.some(entry=>entry.text.includes('ORBIT-913')))
    assert(memory.entries.length<32)
    store.close();store=new WorkspaceMemory(path)
    assert.equal(store.list().active,81)
    assert.equal(store.list('ORBIT-913').total,1)
    assert(searchTokens('火星探测项目').includes('探测'))
  }finally{store.close();rmSync(path,{recursive:true,force:true})}
})
test('memory edits use revisions, archive prevents recall, pinned entries survive unrelated queries',()=>{
  const path=temp(),store=new WorkspaceMemory(path)
  try {
    const entry=store.edit({text:'论文项目代号 PAPER-451',pinned:true},store.revision())
    const revision=store.revision()
    assert(store.recall('无关问题',defaultMemory).state.entries.some(item=>item.id===entry.id))
    assert.deepEqual(store.recall('周末烤面包', defaultMemory, 'topic').state.entries, [])
    assert(store.recall('论文项目', defaultMemory, 'topic').state.entries.some(item => item.id === entry.id))
    store.edit({id:entry.id,archived:true},revision)
    assert.throws(()=>store.edit({id:entry.id,text:'旧窗口覆盖'},revision))
    assert(!store.recall('PAPER-451',defaultMemory).state.entries.some(item=>item.id===entry.id))
    assert.equal(store.list('',true).total,1)
    store.edit({id:entry.id,archived:false},store.revision())
    assert.equal(store.list().active,1)
  }finally{store.close();rmSync(path,{recursive:true,force:true})}
})
test('legacy import is idempotent and separate workspaces never share memories',()=>{
  const a=temp(),b=temp(),first=new WorkspaceMemory(a),second=new WorkspaceMemory(b)
  try{
    const memory={...defaultMemory,entries:[{id:'legacy',text:'旧版用户偏好',source:'manual' as const,archived:false,updatedAt:new Date().toISOString()}]}
    first.importLegacy(memory);first.edit({id:'legacy',archived:true},first.revision());first.importLegacy(memory)
    assert.equal(first.list().active,0);assert.equal(first.list('',true).total,1);assert.equal(second.list().active,0)
    assert.equal(JSON.parse(readFileSync(first.export(),'utf8')).entries[0].archived,true)
  }finally{first.close();second.close();rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true})}
})
test('model memory changes remain evidence-checked, atomic and retire deleted Bot IDs',()=>{
  const path=temp(),store=new WorkspaceMemory(path)
  try{
    const action={action:'remember',text:'用户代号 bot-retired',evidence:'我的代号是 bot-retired'}
    assert.equal(store.applyActions([action],'请记住：我的代号是 bot-retired','group-one',defaultMemory,store.revision()).remembered,1)
    assert.throws(()=>store.applyActions([{...action,evidence:'捏造的依据'}],'用户没有说过','group-two',defaultMemory,store.revision()))
    assert.equal(store.list().active,1)
    store.retireIds(['bot-retired'])
    assert(!store.recall('代号',defaultMemory).state.entries[0].text.includes('bot-retired'))
    assert.equal(store.recall('代号',{...defaultMemory,enabled:false}).state.entries.length,0)
  }finally{store.close();rmSync(path,{recursive:true,force:true})}
})
test('memory storage rejects a symlink escape from the chosen workspace',()=>{
  const path=temp(),outside=temp()
  try{symlinkSync(outside,join(path,'.dsh-bots'));assert.throws(()=>new WorkspaceMemory(path));assert.throws(()=>new WorkspaceMemory('relative-path'))}
  finally{rmSync(path,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}
})
test('King creates user-requested Bots with fresh IDs and skips duplicates on retry',()=>{
  const user='请创建两个子bot，一个负责架构，一个负责审阅。'
  let id=0
  const actions=[{name:'架构顾问',duty:'负责技术方案与模块边界',evidence:user},{name:'质量顾问',duty:'负责审阅与验收',evidence:user}]
  const result=createRequestedBots(defaultLibrary,actions,user,()=>String(++id))
  assert.equal(result.created.length,2);assert.notEqual(result.created[0].id,result.created[1].id)
  const retry = createRequestedBots(result.library, actions, user, () => assert.fail('Existing Bots must keep their identity'))
  assert.deepEqual(retry.created, [])
  assert.deepEqual(retry.existing, result.created)
  assert.throws(()=>createRequestedBots(defaultLibrary,actions,'讲个笑话',()=>String(++id)))
  assert.throws(()=>createRequestedBots(defaultLibrary,[{...actions[0],evidence:'不存在的创建指令'}],user,()=>String(++id)))
  assert.equal(defaultLibrary.bots.length,0)
})

test('King accepts colloquial batches and normalizes names while requiring a direct request', () => {
  const user = '方案/流程助手、资料整理助手、结果复核助手你都帮我建立一下'
  const actions = ['方案/流程助手', '资料整理助手', '结果复核助手'].map(name => ({ name, duty: '协助整理合成任务', evidence: user }))
  let id = 0
  const result = createRequestedBots(defaultLibrary, actions, user, () => String(++id))
  assert.deepEqual(result.created.map(bot => bot.name), ['方案-流程助手', '资料整理助手', '结果复核助手'])
  for (const request of ['不要建立一个资料整理助手', '如何创建助手', '示例：“帮我建立一个助手”', '> 帮我建立一个助手\n只看上面的示例']) {
    assert.throws(() => createRequestedBots(defaultLibrary, [{ ...actions[0], evidence: request }], request, () => assert.fail()), /明确的创建请求/)
  }
  assert.throws(() => createRequestedBots(defaultLibrary, [{ ...actions[0], name: '///' }], user, () => assert.fail()), /第 1 个子 Bot：名称/)
})

test('King isolates a name conflict while creating the remaining requested roles', () => {
  const user = '请创建实验设计助手和数据分析助手'
  const library = { ...defaultLibrary, bots: [{ id: 'existing-design', name: '实验设计助手', duty: '审核摄影构图', archived: false }] }
  const result = createRequestedBots(library, [
    { name: '实验设计助手', duty: '保留方法论和研究实验设计要求', evidence: user },
    { name: '数据分析助手', duty: '处理数据并检查统计假设', evidence: user },
  ], user, () => 'new-analysis')
  assert.deepEqual(result.conflicts, ['实验设计助手'])
  assert.deepEqual(result.created.map(bot => bot.name), ['数据分析助手'])
  assert.deepEqual(result.library.bots[0], library.bots[0])
})
