import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertRootCreation, isKingWorkspace } from '../src/workspace-policy.ts'

test('King workspace rejects new root chats including symlink aliases, but permits children, recovery and other workspaces',()=>{
  const root=mkdtempSync(join(tmpdir(),'dsh-policy-')), path=join(root,'Bots'), other=join(root,'Other'), alias=join(root,'alias')
  mkdirSync(path);mkdirSync(other);symlinkSync(path,alias)
  const selected={path,sessionId:'king'}
  try {
    for(const cwd of [path,alias])assert.throws(()=>assertRootCreation(selected,{cwd,sessionId:'ordinary',source:'startup'}),/不允许.*新建/)
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'child',source:'startup',origin:'subagent'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'king',source:'resume'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'historical',source:'resume'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:other,sessionId:'group',source:'startup'}))
    assert.doesNotThrow(()=>assertRootCreation(selected,{cwd:path,sessionId:'bot-session',source:'startup'},['bot-session']))
    assert.throws(()=>assertRootCreation(selected,{cwd:path,sessionId:'second-bot-session',source:'startup'},['bot-session']),/不允许.*新建/)
    assert.equal(isKingWorkspace(alias,selected),true);assert.equal(isKingWorkspace(other,selected),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})


test('UI creation rejects new and reused King-workspace chats before the host call, while other workspaces and cleanup remain usable',async()=>{
  const {guardWorkspaceCreation}=await import('../src/workspace-guard.ts')
  let selected:string|undefined='/king',calls=0
  const creator={async create(_request?:{workspaceId?:string;cwd?:string;sessionId?:string}){calls++;return 'created'}}
  const original=creator.create
  const stop=guardWorkspaceCreation(creator,async()=>selected,id=>id==='king'?'/king':'/other')
  for(const request of [{workspaceId:'king'},{workspaceId:'king',sessionId:'blank-bot'},{cwd:'/king'}])await assert.rejects(()=>creator.create(request),/不允许.*新建/)
  assert.equal(calls,0)
  assert.equal(await creator.create({workspaceId:'other'}),'created')
  selected=undefined
  assert.equal(await creator.create({workspaceId:'king'}),'created')
  stop();assert.equal(creator.create,original)
  await creator.create({workspaceId:'king'});assert.equal(calls,3)
})


test('creation guard restores inherited methods even when the service returns fresh method proxies',async()=>{
  const {guardWorkspaceCreation}=await import('../src/workspace-guard.ts')
  class Creator {async create(){return 'native'}}
  const target=new Creator()
  const creator=new Proxy(target,{get(object,key,receiver){const value=Reflect.get(object,key,receiver);return typeof value==='function'?new Proxy(value,{}):value}})
  const stop=guardWorkspaceCreation(creator,async()=>'/king',()=>'/king')
  const invoke=creator as import('../src/workspace-guard.ts').ConversationCreator
  await assert.rejects(()=>invoke.create({workspaceId:'king'}),/不允许.*新建/)
  stop()
  assert.equal(Object.hasOwn(target,'create'),false)
  assert.equal(await creator.create(),'native')
})
