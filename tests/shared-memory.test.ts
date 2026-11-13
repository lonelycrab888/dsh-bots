import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SharedGroupMemory } from '../src/shared-memory.ts'
import { WorkspaceMemory } from '../src/workspace-memory.ts'
import type { Group } from '../src/bots.ts'

const group = (text: string): Group => ({members:[],sessionEpoch:0,rows:[{id:'same-row',author:'bot',botId:'bot-a',status:'done',text,reasoning:'PRIVATE-REASONING'}]})

test('group memory keeps source IDs, full originals, status and persistence without sharing private conversations or reasoning', () => {
  const root = mkdtempSync(join(tmpdir(),'dsh-shared-'))
  let store = new SharedGroupMemory(root)
  try {
    store.sync('A','同名群',group('甲群结论 budget 12'))
    store.sync('B','同名群',group('乙群结论 budget 34'))
    store.sync('private','独聊',{...group('PRIVATE-CHAT'),mode:'bot',botId:'bot-a'})
    store.sync('king','KingBot',{...group('KING-PRIVATE'),mode:'king'})
    store.sync('hidden','隐藏',{members:[],rows:[{id:'hidden',author:'bot',botId:'a',status:'done',text:'SECRET',privateToKing:true},{id:'pending',author:'bot',botId:'a',status:'working',text:'PENDING'}]})
    assert.deepEqual(new Set(store.read(0,{query:'budget'}).messages.map(row=>row.groupId)),new Set(['A','B']))
    for (const query of ['PRIVATE','SECRET','PENDING','REASONING']) assert.equal(store.read(0,{query}).messages.length,0)
    const long = '正常内容'.repeat(800) + ' TAIL-EXACT-734'
    store.sync('A','同名群',group(long))
    assert.equal(store.read(0,{query:'TAIL-EXACT-734'}).messages.length,1)
    const head = store.read(0,{groupId:'A',messageId:'same-row'}).messages[0]
    assert.equal(head.nextOffset,1200)
    assert.equal(store.read(0,{groupId:'A',messageId:'same-row',offset:3200}).messages[0].text,' TAIL-EXACT-734')
    store.sync('C','未完成',{members:[],rows:[{id:'partial',author:'bot',botId:'a',status:'stopped',text:'INCOMPLETE'}]})
    assert.equal(store.read(0,{query:'INCOMPLETE'}).messages[0].status,'stopped')
    assert.equal(store.read(1).messages.length,0)
    store.close();store = new SharedGroupMemory(root)
    assert.equal(store.read(0,{groupId:'B'}).messages[0].text,'乙群结论 budget 34')
    // Replaying a session after restart is idempotent.
    store.sync('B','同名群',group('乙群结论 budget 34'))
    assert.equal(store.read(0,{groupId:'B'}).messages.length,1)
  } finally {store.close();rmSync(root,{recursive:true,force:true})}
})

test('personal memory is isolated per Bot and from King, and independent of shared group memory', () => {
  const root = mkdtempSync(join(tmpdir(),'dsh-personal-'))
  const king = new WorkspaceMemory(root), a = new WorkspaceMemory(root,'a'), b = new WorkspaceMemory(root,'b'), shared = new SharedGroupMemory(root)
  try {
    a.edit({text:'用户希望 concise 42'},a.revision())
    shared.sync('group','共享群',group('共享讨论结论'))
    assert.equal(a.list().active,1)
    assert.equal(b.list().active,0)
    assert.equal(king.list().active,0)
    king.reset()
    assert.equal(a.list().active,1)
    assert.equal(shared.read(0).messages.length,1)
    assert.equal(shared.read(0,{query:'concise'}).messages.length,0)
  } finally {[king,a,b,shared].forEach(store=>store.close());rmSync(root,{recursive:true,force:true})}
})
